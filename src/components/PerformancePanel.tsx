import { useState, useRef, useEffect } from 'react';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { cn } from '@/lib/utils';

export default function PerformancePanel() {
  const { stats } = useSimulationStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsHistoryRef = useRef<number[]>([]);

  useEffect(() => {
    fpsHistoryRef.current.push(stats.fps);
    if (fpsHistoryRef.current.length > 60) {
      fpsHistoryRef.current.shift();
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const history = fpsHistoryRef.current;
    if (history.length < 2) return;

    const maxFps = Math.max(...history, 60);
    const minFps = Math.min(...history, 0);
    const range = maxFps - minFps || 1;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.8)';
    ctx.lineWidth = 2;

    history.forEach((fps, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = height - ((fps - minFps) / range) * (height - 4) - 2;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }, [stats.fps]);

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return 'text-green-400';
    if (fps >= 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="absolute top-4 left-4 z-10">
      <div className={cn(
        'glass-panel rounded-xl overflow-hidden transition-all duration-300',
        isExpanded ? 'w-64' : 'w-auto'
      )}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-fluid-cyan" />
            <span className="text-sm font-medium text-white/80">性能监控</span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-white/50" />
          ) : (
            <ChevronDown className="w-4 h-4 text-white/50" />
          )}
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 space-y-3">
            <div className="text-center py-2">
              <span className={cn(
                'font-mono text-5xl font-bold text-glow',
                getFpsColor(stats.fps)
              )}>
                {stats.fps.toFixed(0)}
              </span>
              <span className="text-white/50 text-sm font-mono ml-1">FPS</span>
            </div>

            <canvas
              ref={canvasRef}
              width={232}
              height={60}
              className="w-full rounded bg-black/30"
            />

            <div className="space-y-2 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">粒子数</span>
                <span className="text-fluid-cyan">{stats.particleCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Compute</span>
                <span className="text-white">{stats.computeTime.toFixed(2)} ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Render</span>
                <span className="text-white">{stats.renderTime.toFixed(2)} ms</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2">
                <span className="text-white/50">Total</span>
                <span className="text-accent-pink">{stats.totalTime.toFixed(2)} ms</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
