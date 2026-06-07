import { useState } from 'react';
import {
  Settings,
  Play,
  Pause,
  RotateCcw,
  Eye,
  EyeOff,
  Circle,
  Square,
  Trash2,
  Droplets,
  Waves,
  Wind,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { cn } from '@/lib/utils';

export default function ControlPanel() {
  const [isExpanded, setIsExpanded] = useState(true);
  const {
    params,
    isPaused,
    showParticles,
    showHeightField,
    obstacleType,
    obstacleRadius,
    setParams,
    togglePaused,
    reset,
    setShowParticles,
    setShowHeightField,
    setObstacleType,
    setObstacleRadius,
    clearObstacles,
  } = useSimulationStore();

  const handleSliderChange = (key: keyof typeof params, value: number) => {
    setParams({ [key]: value });
  };

  const handlePreset = (preset: 'dam' | 'calm' | 'stir') => {
    switch (preset) {
      case 'dam':
        setParams({
          particleCount: 100000,
          smoothingRadius: 25,
          viscosity: 0.01,
          pressureStiffness: 300,
          gravityY: 980,
          damping: 0.998,
        });
        break;
      case 'calm':
        setParams({
          particleCount: 50000,
          smoothingRadius: 30,
          viscosity: 0.05,
          pressureStiffness: 150,
          gravityY: 500,
          damping: 0.99,
        });
        break;
      case 'stir':
        setParams({
          particleCount: 80000,
          smoothingRadius: 20,
          viscosity: 0.005,
          pressureStiffness: 250,
          gravityY: 200,
          damping: 0.999,
        });
        break;
    }
  };

  const sliderConfig = [
    { key: 'particleCount' as const, label: '粒子数', min: 1000, max: 200000, step: 1000, unit: '' },
    { key: 'smoothingRadius' as const, label: '平滑半径', min: 10, max: 50, step: 1, unit: 'px' },
    { key: 'viscosity' as const, label: '粘度', min: 0, max: 0.1, step: 0.001, unit: '' },
    { key: 'pressureStiffness' as const, label: '压强系数', min: 50, max: 500, step: 10, unit: '' },
    { key: 'gravityY' as const, label: '重力', min: 0, max: 2000, step: 10, unit: '' },
    { key: 'damping' as const, label: '阻尼', min: 0.9, max: 1, step: 0.001, unit: '' },
  ];

  return (
    <div className="absolute top-4 right-4 z-10">
      <div className={cn(
        'glass-panel rounded-xl overflow-hidden transition-all duration-300 w-72',
      )}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-fluid-cyan" />
            <span className="text-sm font-medium text-white/80">控制面板</span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-white/50" />
          ) : (
            <ChevronDown className="w-4 h-4 text-white/50" />
          )}
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 space-y-5 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">仿真控制</h3>
              <div className="flex gap-2">
                <button
                  onClick={togglePaused}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all',
                    isPaused
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                      : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30'
                  )}
                >
                  {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  {isPaused ? '继续' : '暂停'}
                </button>
                <button
                  onClick={reset}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/80 border border-white/20 hover:bg-white/20 transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                  重置
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">参数调节</h3>
              <div className="space-y-3">
                {sliderConfig.map(({ key, label, min, max, step, unit }) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-white/70">{label}</span>
                      <span className="font-mono text-fluid-cyan">
                        {params[key].toFixed(key === 'viscosity' || key === 'damping' ? 3 : 0)}
                        {unit && <span className="text-white/50 ml-1">{unit}</span>}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={params[key]}
                      onChange={(e) => handleSliderChange(key, parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">显示控制</h3>
              <div className="space-y-2">
                <button
                  onClick={() => setShowParticles(!showParticles)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2 rounded-lg transition-all',
                    showParticles
                      ? 'bg-fluid-cyan/20 text-fluid-cyan border border-fluid-cyan/30'
                      : 'bg-white/10 text-white/50 border border-white/20'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {showParticles ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    显示粒子
                  </span>
                  <div className={cn(
                    'w-10 h-5 rounded-full p-0.5 transition-colors',
                    showParticles ? 'bg-fluid-cyan' : 'bg-white/20'
                  )}>
                    <div className={cn(
                      'w-4 h-4 rounded-full bg-white transition-transform',
                      showParticles ? 'translate-x-5' : 'translate-x-0'
                    )} />
                  </div>
                </button>
                <button
                  onClick={() => setShowHeightField(!showHeightField)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2 rounded-lg transition-all',
                    showHeightField
                      ? 'bg-fluid-cyan/20 text-fluid-cyan border border-fluid-cyan/30'
                      : 'bg-white/10 text-white/50 border border-white/20'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {showHeightField ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    显示高度场
                  </span>
                  <div className={cn(
                    'w-10 h-5 rounded-full p-0.5 transition-colors',
                    showHeightField ? 'bg-fluid-cyan' : 'bg-white/20'
                  )}>
                    <div className={cn(
                      'w-4 h-4 rounded-full bg-white transition-transform',
                      showHeightField ? 'translate-x-5' : 'translate-x-0'
                    )} />
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">障碍物工具</h3>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setObstacleType('circle')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all',
                      obstacleType === 'circle'
                        ? 'bg-accent-pink/20 text-accent-pink border border-accent-pink/30'
                        : 'bg-white/10 text-white/70 border border-white/20 hover:bg-white/20'
                    )}
                  >
                    <Circle className="w-4 h-4" />
                    圆形
                  </button>
                  <button
                    onClick={() => setObstacleType('rect')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all',
                      obstacleType === 'rect'
                        ? 'bg-accent-pink/20 text-accent-pink border border-accent-pink/30'
                        : 'bg-white/10 text-white/70 border border-white/20 hover:bg-white/20'
                    )}
                  >
                    <Square className="w-4 h-4" />
                    矩形
                  </button>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/70">半径</span>
                    <span className="font-mono text-accent-pink">{obstacleRadius} px</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={1}
                    value={obstacleRadius}
                    onChange={(e) => setObstacleRadius(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
                <button
                  onClick={clearObstacles}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  清除障碍物
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">预设场景</h3>
              <div className="space-y-2">
                <button
                  onClick={() => handlePreset('dam')}
                  className="w-full flex items-center gap-3 px-4 py-2 rounded-lg bg-white/10 text-white/80 border border-white/20 hover:bg-white/20 transition-all"
                >
                  <Droplets className="w-4 h-4 text-fluid-cyan" />
                  <span className="text-left">
                    <div className="text-sm font-medium">水坝破裂</div>
                    <div className="text-xs text-white/50">大量粒子快速流动</div>
                  </span>
                </button>
                <button
                  onClick={() => handlePreset('calm')}
                  className="w-full flex items-center gap-3 px-4 py-2 rounded-lg bg-white/10 text-white/80 border border-white/20 hover:bg-white/20 transition-all"
                >
                  <Waves className="w-4 h-4 text-fluid-blue" />
                  <span className="text-left">
                    <div className="text-sm font-medium">平静水面</div>
                    <div className="text-xs text-white/50">低粘度平稳流动</div>
                  </span>
                </button>
                <button
                  onClick={() => handlePreset('stir')}
                  className="w-full flex items-center gap-3 px-4 py-2 rounded-lg bg-white/10 text-white/80 border border-white/20 hover:bg-white/20 transition-all"
                >
                  <Wind className="w-4 h-4 text-fluid-purple" />
                  <span className="text-left">
                    <div className="text-sm font-medium">搅拌流动</div>
                    <div className="text-xs text-white/50">低重力湍流效果</div>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
