import { useState } from 'react';
import {
  Users,
  UserPlus,
  Share2,
  LogOut,
  Copy,
  Check,
  Crown,
  Eye,
  User,
} from 'lucide-react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { cn } from '@/lib/utils';

export default function MultiplayerBar() {
  const [copied, setCopied] = useState(false);
  const {
    multiplayer,
    setMultiplayerMode,
    setRoomId,
    setViewerCount,
    setConnected,
    resetMultiplayer,
  } = useSimulationStore();

  const { mode, roomId, viewerCount, connected } = multiplayer;

  const handleCreateRoom = async () => {
    try {
      setMultiplayerMode('host');
      setConnected(true);
      const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      setRoomId(newRoomId);
      setViewerCount(0);
    } catch (error) {
      console.error('Failed to create room:', error);
    }
  };

  const handleShare = async () => {
    if (!roomId) return;

    const shareUrl = `${window.location.origin}?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleLeave = () => {
    resetMultiplayer();
  };

  const getModeIcon = () => {
    switch (mode) {
      case 'host':
        return <Crown className="w-4 h-4 text-accent-yellow" />;
      case 'viewer':
        return <Eye className="w-4 h-4 text-fluid-cyan" />;
      default:
        return <User className="w-4 h-4 text-white/60" />;
    }
  };

  const getModeText = () => {
    switch (mode) {
      case 'host':
        return '主持人';
      case 'viewer':
        return '观众';
      default:
        return '单人模式';
    }
  };

  const getModeColor = () => {
    switch (mode) {
      case 'host':
        return 'text-accent-yellow';
      case 'viewer':
        return 'text-fluid-cyan';
      default:
        return 'text-white/60';
    }
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
      <div className="glass-panel rounded-full px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-2">
          {getModeIcon()}
          <span className={cn('text-sm font-medium', getModeColor())}>
            {getModeText()}
          </span>
        </div>

        {mode !== 'solo' && (
          <>
            <div className="w-px h-6 bg-white/20" />

            <div className="flex items-center gap-2">
              <span className="text-white/50 text-sm">房间</span>
              <span className="font-mono text-white font-medium text-sm">
                {roomId}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-white/50" />
              <span className="text-sm text-white/80">
                {viewerCount} <span className="text-white/50">在线</span>
              </span>
            </div>

            <div className="w-px h-6 bg-white/20" />

            {mode === 'host' && (
              <button
                onClick={handleShare}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all',
                  copied
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-white/10 text-white/80 hover:bg-white/20'
                )}
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    已复制
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <Copy className="w-3.5 h-3.5" />
                    分享
                  </>
                )}
              </button>
            )}

            <button
              onClick={handleLeave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              离开
            </button>
          </>
        )}

        {mode === 'solo' && (
          <>
            <div className="w-px h-6 bg-white/20" />

            <button
              onClick={handleCreateRoom}
              disabled={connected}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm bg-fluid-cyan/20 text-fluid-cyan hover:bg-fluid-cyan/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserPlus className="w-4 h-4" />
              创建房间
            </button>
          </>
        )}

        {connected && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">已连接</span>
          </div>
        )}
      </div>
    </div>
  );
}
