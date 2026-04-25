import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

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
    if (typeof value.url === 'string') return value.url;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const predictionId = String(req.query.id || '');
  if (!predictionId) {
    return res.status(400).json({ error: 'Missing prediction id' });
  }

  try {
    const prediction = await replicate.predictions.get(predictionId);

    if (prediction.status === 'starting' || prediction.status === 'processing') {
      return res.json({
        success: true,
        pending: true,
        status: prediction.status,
      });
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return res.status(500).json({
        success: false,
        pending: false,
        error: prediction.error || `Prediction ${prediction.status}`,
      });
    }

    const resultImage = extractGptImage2Result(prediction.output);
    if (!resultImage) {
      return res.status(500).json({
        success: false,
        pending: false,
        error: 'Prediction completed but no image output was found',
      });
    }

    return res.json({
      success: true,
      pending: false,
      analysis: '[GPT Image 2 生成完成]\n\n图片已生成。',
      resultImage,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      pending: false,
      error: error.message || 'Failed to fetch prediction status',
    });
  }
}
