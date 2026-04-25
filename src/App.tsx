/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Layers, 
  Image as ImageIcon, 
  Send, 
  Undo, 
  Download, 
  Trash2, 
  Brush, 
  Eraser,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Split,
  History,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { UI_STRINGS, COLORS } from './constants';

// --- Types ---
interface ProcessingResult {
  success: boolean;
  analysis: string;
  resultImage: string;
}

// --- Components ---

const ComparisonSlider = ({ before, after }: { before: string; after: string }) => {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const relativeX = Math.max(0, Math.min(x - rect.left, rect.width));
    setSliderPos((relativeX / rect.width) * 100);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video overflow-hidden rounded border border-border-base bg-gray-100 cursor-col-resize group"
      onMouseMove={handleMove}
      onTouchMove={handleMove}
    >
      <img src={after} className="absolute inset-0 w-full h-full object-cover" alt="After" referrerPolicy="no-referrer" />
      <div 
        className="absolute inset-0 w-full h-full overflow-hidden" 
        style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
      >
        <img src={before} className="absolute inset-0 w-full h-full object-cover" alt="Before" referrerPolicy="no-referrer" />
      </div>
      <div 
        className="absolute inset-y-0 w-[2px] bg-csce-orange shadow-lg pointer-events-none"
        style={{ left: `${sliderPos}%` }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-csce-orange text-white text-[10px] px-1.5 py-0.5 rounded-full shadow-md whitespace-nowrap">
          &lt; &gt;
        </div>
      </div>
      <div className="absolute bottom-2 left-2 text-[10px] text-white bg-black/50 px-2 py-0.5 rounded">修改前</div>
      <div className="absolute bottom-2 right-2 text-[10px] text-white bg-black/50 px-2 py-0.5 rounded">生成后</div>
    </div>
  );
};

export default function App() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0 });
  const [refImage, setRefImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('nano-banana-pro');
  const [brushSize, setBrushSize] = useState(30);
  const [isEraser, setIsEraser] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [history, setHistory] = useState<ProcessingResult[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showMaskPreview, setShowMaskPreview] = useState(false);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | null>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  // Compute the image display size to match object-contain behavior,
  // so the canvas overlay is pixel-aligned with the image.
  useEffect(() => {
    if (!imageContainerRef.current || imgDimensions.width === 0) return;

    const updateSize = () => {
      const container = imageContainerRef.current;
      if (!container) return;
      const { width: cw, height: ch } = container.getBoundingClientRect();
      const imgAspect = imgDimensions.width / imgDimensions.height;
      const containerAspect = cw / ch;

      let dw, dh;
      if (containerAspect > imgAspect) {
        dh = ch;
        dw = ch * imgAspect;
      } else {
        dw = cw;
        dh = cw / imgAspect;
      }

      setDisplaySize({ width: Math.round(dw), height: Math.round(dh) });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(imageContainerRef.current);
    return () => ro.disconnect();
  }, [imgDimensions]);

  // Initialize Canvas
  useEffect(() => {
    if (canvasRef.current && imgDimensions.width > 0) {
      const canvas = canvasRef.current;
      canvas.width = imgDimensions.width;
      canvas.height = imgDimensions.height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        contextRef.current = ctx;
      }
    }
  }, [imgDimensions]);

  // Update mask preview when toggled
  useEffect(() => {
    if (showMaskPreview) {
      setMaskPreviewUrl(createBinaryMask());
    } else {
      setMaskPreviewUrl(null);
    }
  }, [showMaskPreview]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!contextRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const clientX = ('touches' in e ? e.touches[0].clientX : e.clientX);
    const clientY = ('touches' in e ? e.touches[0].clientY : e.clientY);
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    contextRef.current.beginPath();
    contextRef.current.moveTo(x, y);

    // Set operation: drawing or erasing
    contextRef.current.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    contextRef.current.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : 'rgba(255, 107, 53, 0.4)';
    contextRef.current.lineWidth = brushSize * Math.max(scaleX, scaleY);

    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !contextRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const clientX = ('touches' in e ? e.touches[0].clientX : e.clientX);
    const clientY = ('touches' in e ? e.touches[0].clientY : e.clientY);
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    contextRef.current.lineTo(x, y);
    contextRef.current.stroke();
  };

  const stopDrawing = () => {
    if (contextRef.current) {
      contextRef.current.closePath();
    }
    setIsDrawing(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'original' | 'ref') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (f) => {
        const data = f.target?.result as string;
        if (type === 'original') {
          const img = new Image();
          img.src = data;
          img.onload = () => {
            setImgDimensions({ width: img.width, height: img.height });
            setOriginalImage(data);
            setResult(null);
            // Clear current canvas
            if (contextRef.current && canvasRef.current) {
              contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
          };
        } else {
          setRefImage(data);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Check if canvas has any drawn content
  const hasCanvasContent = (): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] > 10) return true;
    }
    return false;
  };

  // Convert canvas strokes to binary mask for preview (white=edit, black=preserve)
  const createBinaryMask = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    if (!hasCanvasContent()) return null;

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d')!;
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, w, h);

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 10) {
        pixels[i] = 255; pixels[i + 1] = 255; pixels[i + 2] = 255; pixels[i + 3] = 255;
      } else {
        pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255;
      }
    }
    maskCtx.putImageData(imageData, 0, 0);
    return maskCanvas.toDataURL('image/png');
  };

  // Create annotated image: original + red highlight on masked area
  // This is sent to AI models instead of a binary mask, so they can visually see where to edit
  const createAnnotatedImage = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas || !originalImage) { resolve(null); return; }

      const img = new Image();
      img.onload = () => {
        const annotatedCanvas = document.createElement('canvas');
        annotatedCanvas.width = img.width;
        annotatedCanvas.height = img.height;
        const ctx = annotatedCanvas.getContext('2d')!;

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Get mask data from drawing canvas
        const maskCtx = canvas.getContext('2d')!;
        const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);

        // Overlay bright red on masked areas (alpha > 10)
        for (let i = 0; i < maskData.data.length; i += 4) {
          if (maskData.data[i + 3] > 10) {
            // Blend with red: 60% red overlay
            const blend = 0.6;
            imgData.data[i]     = Math.round(imgData.data[i]     * (1 - blend) + 255 * blend); // R
            imgData.data[i + 1] = Math.round(imgData.data[i + 1] * (1 - blend) + 30  * blend); // G
            imgData.data[i + 2] = Math.round(imgData.data[i + 2] * (1 - blend) + 30  * blend); // B
            imgData.data[i + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);

        resolve(annotatedCanvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = originalImage;
    });
  };

  const handleDownload = async () => {
    if (!result?.resultImage) return;
    try {
      const link = document.createElement('a');
      link.href = result.resultImage;
      link.download = `ai_edited_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error('Download failed:', err);
      window.open(result.resultImage, '_blank');
    }
  };

  const handleGenerate = async () => {
    if (!originalImage || !prompt || !canvasRef.current) {
      alert('请确保已上传图片并输入修改指令');
      return;
    }

    if (!hasCanvasContent()) {
      alert('请先用画笔标注需要修改的区域');
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      // Create annotated image (original + red highlight) for AI to see where to edit
      const annotatedImage = await createAnnotatedImage();
      if (!annotatedImage) {
        alert('创建标注图失败，请重试');
        return;
      }

      console.log('[Frontend] Sending request to API, model:', selectedModel);
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotatedImage,
          referenceImage: refImage,
          prompt,
          model: selectedModel,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const rawText = await res.text();
        throw new Error(`API 返回了非 JSON 响应（HTTP ${res.status}）: ${rawText.slice(0, 120)}`);
      }

      const data = await res.json();
      console.log('[Frontend] API Response:', data);

      if (!res.ok) {
        throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
      }

      if (data.success) {
        const newResult: ProcessingResult = {
          success: true,
          analysis: data.analysis,
          resultImage: data.resultImage || originalImage
        };

        setResult(newResult);
        setHistory(prev => [newResult, ...prev]);

        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#1f3a5f', '#ff6b35', '#ffffff']
        });
      } else {
        alert('AI 生成失败: ' + (data.error || '服务器未返回错误信息'));
      }
    } catch (err) {
      console.error('[Frontend] Fetch error:', err);
      alert('网络连接失败，请检查后端运行状态');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden font-sans bg-bg-base">
      <header className="h-[60px] bg-csce-blue text-white flex items-center px-6 shadow-[0_2px_4px_rgba(0,0,0,0.1)] z-10 shrink-0">
        <div className="w-8 h-8 bg-csce-orange rounded flex items-center justify-center font-bold text-xl mr-3">正</div>
        <h1 className="text-[18px] font-semibold tracking-wide flex items-baseline">
          {UI_STRINGS.title}
          <span className="ml-3 text-[12px] opacity-70 font-normal">建筑行业 AI 视觉编辑专家</span>
        </h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[260px] bg-white border-r border-border-base p-5 flex flex-col gap-5 overflow-y-auto custom-scrollbar shrink-0">
          <div>
            <div className="section-head">图片上传</div>
            <label className="block w-full border border-dashed border-border-base rounded bg-[#fafafa] p-4 text-center text-xs text-[#999] hover:border-csce-orange hover:text-csce-orange transition-colors cursor-pointer overflow-hidden">
              <input type="file" className="hidden" onChange={(e) => handleImageUpload(e, 'original')} />
              {originalImage ? (
                <img src={originalImage} className="w-full h-24 object-cover rounded shadow-inner" alt="Original" referrerPolicy="no-referrer" />
              ) : (
                "点击上传现场原图\n(JPG, PNG)"
              )}
            </label>
          </div>

          <div>
            <div className="section-head">标注工具</div>
            <div className="flex gap-2">
              <button 
                onClick={() => setIsEraser(false)}
                className={`flex-1 py-1.5 px-3 text-xs flex items-center justify-center gap-2 rounded border transition ${!isEraser ? 'bg-csce-blue text-white border-csce-blue shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}
              >
                🖌️ 画笔
              </button>
              <button 
                onClick={() => setIsEraser(true)}
                className={`flex-1 py-1.5 px-3 text-xs flex items-center justify-center gap-2 rounded border transition ${isEraser ? 'bg-csce-blue text-white border-csce-blue shadow-md' : 'bg-white text-gray-600 border-gray-200'}`}
              >
                🧽 橡皮
              </button>
            </div>
            <div className="mt-4 space-y-1">
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>画笔大小</span>
                <span>{brushSize}px</span>
              </div>
              <input 
                type="range" min="5" max="150" value={brushSize} 
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-csce-orange"
              />
            </div>
          </div>

          <div>
            <div className="section-head">AI 模型</div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full p-2 border border-border-base rounded text-xs outline-none focus:border-csce-orange bg-[#fcfcfc] cursor-pointer"
            >
              <option value="nano-banana-pro">Nano Banana Pro (Google)</option>
              <option value="nano-banana-2">Nano Banana 2 (Google)</option>
              <option value="seedream-5-lite">Seedream 5.0 Lite (字节跳动)</option>
              <option value="gpt-image-2">GPT Image 2 (OpenAI)</option>
            </select>
            <p className="mt-1 text-[10px] text-gray-400 leading-snug">
              {selectedModel === 'nano-banana-pro' && '稳定高效，适合大多数施工图编辑场景'}
              {selectedModel === 'nano-banana-2' && '最新版本，支持更多参考图和更高分辨率'}
              {selectedModel === 'seedream-5-lite' && '内置推理能力，擅长基于参考图的样式匹配'}
              {selectedModel === 'gpt-image-2' && 'OpenAI 图像编辑模型，支持多图输入，适合参考图驱动的精细修改'}
            </p>
          </div>

          <div>
            <div className="section-head">修改意图</div>
            <textarea
              className="w-full p-3 border border-border-base rounded text-xs outline-none focus:border-csce-orange h-24 resize-none bg-[#fcfcfc]"
              placeholder="例如：将该区域替换为已完成的钢筋混凝土护坡..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div>
            <div className="section-head">参考图</div>
            <label className="block w-full border border-dashed border-border-base rounded bg-[#fafafa] py-3 text-center text-xs text-[#999] hover:border-csce-orange hover:text-csce-orange transition-colors cursor-pointer overflow-hidden">
              <input type="file" className="hidden" onChange={(e) => handleImageUpload(e, 'ref')} />
              {refImage ? (
                <img src={refImage} className="w-full h-16 object-cover rounded" alt="Ref" referrerPolicy="no-referrer" />
              ) : (
                "+ 上传风格参考图"
              )}
            </label>
          </div>

          <button
            disabled={isProcessing || !originalImage || !prompt}
            onClick={handleGenerate}
            className={`w-full py-3 rounded font-bold text-sm text-white mt-auto transition-all active:scale-95 shadow-lg ${
              isProcessing || !originalImage || !prompt ? 'bg-gray-400' : 'bg-csce-orange hover:bg-orange-600'
            }`}
          >
            {isProcessing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> AI 生成中...
              </span>
            ) : '智能生成模拟效果'}
          </button>
        </aside>

        <main className="flex-1 bg-[#2c2c2c] p-10 flex items-center justify-center relative overflow-hidden">
          <div 
            className="relative shadow-2xl bg-black flex items-center justify-center border-4 border-[#3c3c3c] rounded"
            style={{ 
              width: '100%', 
              height: '100%',
              maxWidth: imgDimensions.width > 0 ? 'min(calc(100% - 40px), 1200px)' : '800px',
              maxHeight: imgDimensions.height > 0 ? 'min(calc(100% - 40px), 800px)' : '500px',
              aspectRatio: imgDimensions.width > 0 ? `${imgDimensions.width}/${imgDimensions.height}` : '16/9'
            }}
          >
            {!originalImage ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[#555] p-8 text-center bg-gray-900 rounded">
                 <ImageIcon className="w-20 h-20 mb-3 opacity-20" />
                 <p className="text-sm font-bold tracking-wide uppercase">请上传现场施工原图</p>
                 <p className="text-[10px] mt-1 opacity-60">支持常见图像格式，AI 将自动识别环境参数</p>
              </div>
            ) : (
              <div ref={imageContainerRef} className="relative w-full h-full flex items-center justify-center overflow-hidden">
                {/* Wrapper sized by JS to match object-contain behavior.
                    Both img and canvas fill this wrapper exactly — NO letterboxing. */}
                <div
                  className="relative"
                  style={{
                    width: displaySize.width,
                    height: displaySize.height,
                  }}
                >
                  <img
                    src={originalImage}
                    className="absolute inset-0 w-full h-full pointer-events-none select-none"
                    alt="Original"
                    referrerPolicy="no-referrer"
                  />

                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full touch-none cursor-crosshair z-10"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />

                  {/* Mask preview overlay */}
                  {showMaskPreview && maskPreviewUrl && (
                    <img
                      src={maskPreviewUrl}
                      className="absolute inset-0 w-full h-full pointer-events-none z-20 opacity-50"
                      alt="Mask Preview"
                    />
                  )}
                </div>

                <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1.5 border border-white/10 rounded flex items-center gap-2 text-[10px] pointer-events-none z-30 backdrop-blur-md">
                   <div className="w-2 h-2 rounded-full bg-csce-orange animate-pulse" />
                   AI 辅助标注器
                   <button
                     onClick={() => setShowMaskPreview(p => !p)}
                     className="ml-2 px-2 py-0.5 rounded border border-white/20 hover:bg-white/10 transition pointer-events-auto"
                   >
                     {showMaskPreview ? '隐藏遮罩' : '预览遮罩'}
                   </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-[#888] flex gap-8 whitespace-nowrap bg-black/40 px-6 py-2 rounded-full backdrop-blur-lg border border-white/5">
             <span className="flex items-center gap-1.5"><RotateCcw className="w-3 h-3" /> 使用橡皮擦可精确修正误操作区域</span>
             <span className="opacity-30">|</span>
             <span>系统将自动锁定图像物理比例，确保像素对齐</span>
          </div>
        </main>

        <aside className="w-[300px] bg-white border-l border-border-base p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar shrink-0">
          <div>
            <div className="section-head">效果展示</div>
            {result ? (
              <div className="space-y-4">
                <ComparisonSlider before={originalImage!} after={result.resultImage} />
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg text-[11px] text-[#555] leading-relaxed shadow-inner">
                   <div className="font-bold text-csce-blue mb-1 flex items-center gap-1">
                     <AlertCircle className="w-3 h-3" /> AI 技术诊断：
                   </div>
                   {result.analysis}
                </div>
                <button onClick={handleDownload} className="w-full py-2 border border-csce-blue text-csce-blue rounded text-xs font-bold hover:bg-csce-blue hover:text-white transition flex items-center justify-center gap-2 mt-4 shadow-sm">
                   <Download className="w-4 h-4" /> 导出高清模拟图
                </button>
              </div>
            ) : (
              <div className="h-[220px] bg-gray-50 border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-[11px] text-gray-400 p-6 text-center italic">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <Loader2 className="w-6 h-6 opacity-20" />
                </div>
                等待分析指令并生成对比图...
              </div>
            )}
          </div>

          <div className="flex-1 mt-4">
            <div className="section-head">历史模拟纪录</div>
            <div className="grid grid-cols-2 gap-3">
              {history.map((h, i) => (
                <div key={i} className="aspect-video bg-gray-100 rounded border border-border-base overflow-hidden group cursor-pointer shadow-sm hover:shadow-md transition" onClick={() => setResult(h)}>
                  <img src={h.resultImage} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="Historical result" referrerPolicy="no-referrer" />
                </div>
              ))}
              <div className="aspect-video border-2 border-dashed border-gray-100 rounded flex items-center justify-center text-gray-200 text-xl font-thin">
                +
              </div>
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
             <div className="text-[10px] text-gray-400 mb-2 uppercase font-bold tracking-widest">企业级安全引擎</div>
             <div className="flex gap-2">
                <div className="flex-1 h-1 bg-green-500 rounded-full" />
                <div className="flex-1 h-1 bg-green-500 rounded-full" />
                <div className="flex-1 h-1 bg-csce-orange rounded-full animate-pulse" />
             </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
