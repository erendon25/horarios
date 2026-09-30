"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";

export type SignaturePadHandle = { clear: () => void; isEmpty: () => boolean; toBlob: () => Promise<Blob> };

export const SignaturePad = forwardRef<SignaturePadHandle, { label: string; initialUrl?: string | null }>(function SignaturePad({ label, initialUrl }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(!initialUrl);

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      context?.scale(ratio, ratio);
    }
    const context = canvas.getContext("2d");
    if (context) { context.lineWidth = 2.2; context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = "#172033"; }
    return context;
  }, []);

  useEffect(() => {
    const context = prepareCanvas();
    const canvas = canvasRef.current;
    if (!context || !canvas || !initialUrl) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); context.drawImage(image, 0, 0, canvas.clientWidth, canvas.clientHeight); setEmpty(false); };
    image.src = initialUrl;
  }, [initialUrl, prepareCanvas]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    prepareCanvas()?.clearRect(0, 0, canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0);
    setEmpty(true);
  }, [prepareCanvas]);

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => empty,
    toBlob: () => new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) { reject(new Error("Firma no disponible.")); return; }
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se pudo generar la firma.")), "image/png");
    }),
  }), [clear, empty]);

  return <div className="signature-field"><div className="signature-label"><strong>{label}</strong><button type="button" className="plain-button" onClick={clear}><Eraser size={15}/>Limpiar</button></div><canvas ref={canvasRef} className="signature-canvas" aria-label={label} onPointerDown={(event) => { const context = prepareCanvas(); const position = point(event); drawing.current = true; setEmpty(false); event.currentTarget.setPointerCapture(event.pointerId); context?.beginPath(); context?.moveTo(position.x, position.y); context?.lineTo(position.x + .01, position.y + .01); context?.stroke(); }} onPointerMove={(event) => { if (!drawing.current) return; const position = point(event); const context = prepareCanvas(); context?.lineTo(position.x, position.y); context?.stroke(); }} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}/><small>{empty ? "Firma pendiente" : "Firma registrada"}</small></div>;
});
