import { useRef, useEffect, useState, useCallback } from 'react';
import { useSimulationStore } from '@/store/useSimulationStore';
import type { ObstacleData } from '../../shared/types';

const SIM_WIDTH = 1200;
const SIM_HEIGHT = 800;

export default function ObstacleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);

  const { obstacleType, obstacleRadius, addObstacle } = useSimulationStore();

  const screenToSim = useCallback((screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = ((screenX - rect.left) / rect.width) * SIM_WIDTH;
    const y = ((screenY - rect.top) / rect.height) * SIM_HEIGHT;
    return { x, y };
  }, []);

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawStart || !currentPos) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const startSim = screenToSim(drawStart.x, drawStart.y);
    const currentSim = screenToSim(currentPos.x, currentPos.y);

    const scaleX = canvas.width / SIM_WIDTH;
    const scaleY = canvas.height / SIM_HEIGHT;

    ctx.strokeStyle = 'rgba(255, 0, 128, 0.8)';
    ctx.fillStyle = 'rgba(255, 0, 128, 0.2)';
    ctx.lineWidth = 2;

    if (obstacleType === 'circle') {
      const dx = (currentSim.x - startSim.x) * scaleX;
      const dy = (currentSim.y - startSim.y) * scaleY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const radius = Math.max(distance, obstacleRadius * scaleX);

      ctx.beginPath();
      ctx.arc(startSim.x * scaleX, startSim.y * scaleY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (obstacleType === 'rect') {
      const x = Math.min(startSim.x, currentSim.x) * scaleX;
      const y = Math.min(startSim.y, currentSim.y) * scaleY;
      const width = Math.abs(currentSim.x - startSim.x) * scaleX;
      const height = Math.abs(currentSim.y - startSim.y) * scaleY;

      ctx.beginPath();
      ctx.rect(x, y, width || obstacleRadius * 2 * scaleX, height || obstacleRadius * 2 * scaleY);
      ctx.fill();
      ctx.stroke();
    }
  }, [drawStart, currentPos, obstacleType, obstacleRadius, screenToSim]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  const handleStart = (clientX: number, clientY: number) => {
    setIsDrawing(true);
    setDrawStart({ x: clientX, y: clientY });
    setCurrentPos({ x: clientX, y: clientY });
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDrawing) return;
    setCurrentPos({ x: clientX, y: clientY });
  };

  const handleEnd = (clientX: number, clientY: number) => {
    if (!isDrawing || !drawStart) return;

    const startSim = screenToSim(drawStart.x, drawStart.y);
    const endSim = screenToSim(clientX, clientY);

    let obstacle: ObstacleData;

    if (obstacleType === 'circle') {
      const dx = endSim.x - startSim.x;
      const dy = endSim.y - startSim.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const radius = Math.max(distance, obstacleRadius);

      obstacle = {
        id: `obs_${Date.now()}`,
        type: 'circle',
        x: startSim.x,
        y: startSim.y,
        radius,
      };
    } else {
      const x = Math.min(startSim.x, endSim.x);
      const y = Math.min(startSim.y, endSim.y);
      const width = Math.max(Math.abs(endSim.x - startSim.x), obstacleRadius * 2);
      const height = Math.max(Math.abs(endSim.y - startSim.y), obstacleRadius * 2);

      obstacle = {
        id: `obs_${Date.now()}`,
        type: 'rect',
        x: x + width / 2,
        y: y + height / 2,
        width,
        height,
      };
    }

    addObstacle(obstacle);

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentPos(null);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    handleEnd(e.clientX, e.clientY);
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    if (isDrawing) {
      handleEnd(e.clientX, e.clientY);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    handleEnd(touch.clientX, touch.clientY);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    });

    resizeObserver.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
}
