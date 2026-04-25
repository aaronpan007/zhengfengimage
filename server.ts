import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Replicate from 'replicate';

dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODEL_MAP: Record<string, string> = {
  'nano-banana-pro': 'google/nano-banana-pro',
  'nano-banana-2': 'google/nano-banana-2',
  'seedream-5-lite': 'bytedance/seedream-5-lite',
  'gpt-image-2': 'openai/gpt-image-2',
};

function extractGptImage2Result(value: any): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.startsWith('http') || value.startsWith('data:image/') ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractGptImage2Result(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object') {
    if (typeof value.b64_json === 'string' && value.b64_json.length > 0) {
      return `data:image/png;base64,${value.b64_json}`;
    }

    if (typeof value.url === 'string') {
      return value.url;
    }

    if (typeof value.url === 'function') {
      const urlValue = value.url();
      if (typeof urlValue === 'string') return urlValue;
      if (urlValue?.toString) return urlValue.toString();
    }

    for (const candidate of [value.data, value.output, value.outputs, value.images, value.image, value.result]) {
      const found = extractGptImage2Result(candidate);
      if (found) return found;
    }
  }

  const str = value?.toString?.();
  return typeof str === 'string' && str.startsWith('http') ? str : null;
}

async function extractGptImage2DataUrl(value: any): Promise<string | null> {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = await extractGptImage2DataUrl(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value?.blob === 'function') {
    const blob = await value.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const contentType = blob.type || 'image/png';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  if (typeof value === 'object') {
    for (const candidate of [value.data, value.output, value.outputs, value.images, value.image, value.result]) {
      const found = await extractGptImage2DataUrl(candidate);
      if (found) return found;
    }
  }

  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3001;

  app.use(express.json({ limit: '50mb' }));

  app.post('/api/generate', async (req, res) => {
    console.log('[API] Received generate request');
    try {
      const { originalImage, annotatedImage, referenceImage, prompt, model } = req.body;
      const selectedModel = model || 'nano-banana-pro';

      const apiToken = process.env.REPLICATE_API_TOKEN;
      if (!apiToken || apiToken === 'YOUR_REPLICATE_API_TOKEN') {
        console.error('[API] REPLICATE_API_TOKEN is not configured');
        return res.status(500).json({ error: '请在 .env.local 中配置有效的 REPLICATE_API_TOKEN' });
      }

      const replicateModel = MODEL_MAP[selectedModel];
      if (!replicateModel) {
        return res.status(400).json({ error: `未知模型: ${selectedModel}` });
      }

      console.log(`[AI] Using model: ${replicateModel}`);
      let output: any;
      let modelName: string;

      if (selectedModel === 'seedream-5-lite') {
        modelName = 'Seedream 5.0 Lite';

        const aiPrompt = referenceImage
          ? `You are editing a construction site photo. The image shows a photo with RED-HIGHLIGHTED areas indicating where changes should be made. Reference image shows the target appearance.

TASK: Edit ONLY the red-highlighted areas to match the style, materials, and appearance of the reference image. Keep all non-highlighted areas exactly as they are.

User instruction: ${prompt}`
          : `You are editing a construction site photo. The image shows a photo with RED-HIGHLIGHTED areas indicating where changes should be made.

TASK: Edit ONLY the red-highlighted areas according to the user instruction. Keep all non-highlighted areas exactly as they are. Maintain original lighting and perspective.

User instruction: ${prompt}`;

        const seedreamImages: string[] = [annotatedImage || originalImage];
        if (referenceImage) seedreamImages.push(referenceImage);

        console.log(`[AI] Sending to ${replicateModel}, images: ${seedreamImages.length}, prompt length: ${aiPrompt.length}`);
        output = await replicate.run(replicateModel as `${string}/${string}`, {
          input: {
            prompt: aiPrompt,
            image_input: seedreamImages,
            match_input_image: true,
            output_format: 'png',
          },
        });
      } else if (selectedModel === 'gpt-image-2') {
        modelName = 'GPT Image 2';

        const inputImages: string[] = [annotatedImage || originalImage];
        if (referenceImage) inputImages.push(referenceImage);

        const aiPrompt = referenceImage
          ? `Image editing task.

Image 1: Construction site photo with RED-HIGHLIGHTED areas. The red highlighted parts are the exact regions that need to be modified.
Image 2: Reference image showing the TARGET appearance. Match the highlighted areas to the materials, textures, colors, and structural style in the reference image.

RULES:
- ONLY modify the RED-HIGHLIGHTED areas in Image 1.
- Keep all non-highlighted areas 100% unchanged.
- The result must look natural and seamless, with no red color remaining.
- Maintain the original photo's lighting, perspective, and camera angle.

User instruction: ${prompt}`
          : `Image editing task.

Image 1: Construction site photo with RED-HIGHLIGHTED areas. The red highlighted parts are the exact regions that need to be modified.

RULES:
- ONLY modify the RED-HIGHLIGHTED areas in Image 1.
- Keep all non-highlighted areas 100% unchanged.
- The result must look natural and seamless, with no red color remaining.
- Maintain the original photo's lighting, perspective, and camera angle.

User instruction: ${prompt}`;

        console.log(`[AI] Sending to ${replicateModel}, images: ${inputImages.length}, prompt length: ${aiPrompt.length}`);
        output = await replicate.run(replicateModel as `${string}/${string}`, {
          input: {
            prompt: aiPrompt,
            input_images: inputImages,
            quality: 'auto',
            output_format: 'png',
            background: 'opaque',
          },
        });
      } else {
        modelName = selectedModel === 'nano-banana-2' ? 'Nano Banana 2' : 'Nano Banana Pro';

        const imageInput: string[] = [annotatedImage || originalImage];
        if (referenceImage) imageInput.push(referenceImage);

        const aiPrompt = referenceImage
          ? `Image editing task.

Image 1: Construction site photo with RED-HIGHLIGHTED areas. The red highlighted parts are the exact regions that need to be modified.
Image 2: Reference image showing the TARGET appearance. Replicate its materials, textures, colors, and structural style in the highlighted areas.

RULES:
- ONLY modify the RED-HIGHLIGHTED areas in Image 1.
- Keep all non-highlighted areas 100% unchanged.
- The modified areas must match the reference image (Image 2) in style and appearance.
- The result must look natural and seamless - no red color should remain.
- Maintain the original photo's lighting, perspective, and camera angle.

User instruction: ${prompt}`
          : `Image editing task.

Image 1: Construction site photo with RED-HIGHLIGHTED areas. The red highlighted parts are the exact regions that need to be modified.

RULES:
- ONLY modify the RED-HIGHLIGHTED areas in Image 1.
- Keep all non-highlighted areas 100% unchanged.
- The result must look natural and seamless - no red color should remain.
- Maintain the original photo's lighting, perspective, and camera angle.

User instruction: ${prompt}`;

        console.log(`[AI] Sending to ${replicateModel}, images: ${imageInput.length}, prompt length: ${aiPrompt.length}`);
        output = await replicate.run(replicateModel as `${string}/${string}`, {
          input: {
            prompt: aiPrompt,
            image_input: imageInput,
          },
        });
      }

      console.log('[AI] Prediction completed, output type:', typeof output, Array.isArray(output));

      let resultImageUrl: string | null = null;
      let resultBase64 = originalImage;

      if (selectedModel === 'gpt-image-2') {
        const gptImage2DataUrl = await extractGptImage2DataUrl(output);
        if (gptImage2DataUrl) {
          resultBase64 = gptImage2DataUrl;
        }
        resultImageUrl = extractGptImage2Result(output);
      }

      if (!resultImageUrl && typeof output === 'string') {
        resultImageUrl = output;
      } else if (!resultImageUrl && output != null) {
        if (typeof output.url === 'function') {
          const urlObj = output.url();
          resultImageUrl = typeof urlObj === 'string' ? urlObj : urlObj?.toString?.() || null;
        }

        if (!resultImageUrl) {
          const str = output.toString?.();
          if (typeof str === 'string' && str.startsWith('http')) {
            resultImageUrl = str;
          } else if (Array.isArray(output) && output.length > 0) {
            const first = output[0];
            if (typeof first === 'string') {
              resultImageUrl = first;
            } else if (first != null) {
              if (typeof first.url === 'function') {
                const firstUrlObj = first.url();
                resultImageUrl = typeof firstUrlObj === 'string' ? firstUrlObj : firstUrlObj?.toString?.() || null;
              }

              if (!resultImageUrl) {
                const firstStr = first.toString?.();
                if (typeof firstStr === 'string' && firstStr.startsWith('http')) {
                  resultImageUrl = firstStr;
                }
              }
            }
          }
        }
      }

      console.log('[AI] Extracted URL:', resultImageUrl ? resultImageUrl.slice(0, 80) + '...' : 'null');

      if (selectedModel !== 'gpt-image-2' && resultImageUrl && resultImageUrl.startsWith('http')) {
        try {
          console.log('[AI] Fetching result image to convert to base64...');
          const imgResponse = await fetch(resultImageUrl);
          if (imgResponse.ok) {
            const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
            const contentType = imgResponse.headers.get('content-type') || 'image/png';
            resultBase64 = `data:${contentType};base64,${imgBuffer.toString('base64')}`;
            console.log('[AI] Image converted to base64, size:', imgBuffer.length);
          } else {
            console.warn('[AI] Failed to fetch result image, status:', imgResponse.status);
            resultBase64 = resultImageUrl;
          }
        } catch (e: any) {
          console.warn('[AI] Failed to convert image to base64:', e.message);
          resultBase64 = resultImageUrl;
        }
      } else if (selectedModel !== 'gpt-image-2' && resultImageUrl) {
        resultBase64 = resultImageUrl;
      }

      const analysisText = `[${modelName} 生成完成]\n\n修改指令：${prompt}\n\n已根据标注区域${referenceImage ? '和参考图' : ''}生成修改后的施工效果图。请通过对比滑块查看修改前后的差异。`;

      res.json({
        success: true,
        analysis: analysisText,
        resultImage: resultBase64,
      });
    } catch (error: any) {
      console.error('[API] Error in /api/generate:', error.message || error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process AI request',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
