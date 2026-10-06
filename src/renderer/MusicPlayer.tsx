import { useCallback, useEffect, useRef, useState } from 'react';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import type { TrackSummary } from '../main/musicCatalog';

export type PlaybackRequest = { track: TrackSummary; sequence: number };

function time(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export default function MusicPlayer({
  request,
}: {
  request: PlaybackRequest | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState('');

  const start = useCallback(async (id: number) => {
    const audio = audioRef.current!;
    generation.current += 1;
    const { current } = generation;
    setError('');
    setLoading(true);
    try {
      if (!audio.getAttribute('src')) {
        const result = await window.music.playbackSource(id);
        if (generation.current !== current) return;
        if (!result.ok) throw new Error(result.error.message);
        audio.src = result.data.url;
      }
      await audio.play();
    } catch (cause) {
      if (generation.current === current) {
        setError(
          cause instanceof Error ? cause.message : 'Could not play this track.',
        );
      }
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current!;
    generation.current += 1;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setPlaying(false);
    setPosition(0);
    setLength(0);
    setError('');
    setLoading(false);
    if (request) start(request.track.id);
    return () => {
      generation.current += 1;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [request, start]);

  const toggle = () => {
    if (playing) audioRef.current!.pause();
    else if (request) start(request.track.id);
  };

  const stop = () => {
    generation.current += 1;
    const audio = audioRef.current!;
    audio.pause();
    if (audio.getAttribute('src')) audio.currentTime = 0;
    setPlaying(false);
    setLoading(false);
    setPosition(0);
  };

  return (
    <section className="music-player" aria-label="Music player">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Local music files have no supplied caption tracks. */}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(audioRef.current!.currentTime)}
        onDurationChange={() => {
          const value = audioRef.current!.duration;
          setLength(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onError={() => {
          setPlaying(false);
          setLoading(false);
          setError(
            'Could not load this audio file. Check that it is available and uses a supported codec.',
          );
        }}
      />
      <div className="music-player-title">
        {loading
          ? 'Loading...'
          : request?.track.title ||
            request?.track.path.split(/[\\/]/).pop() ||
            'No track playing'}
      </div>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={!request || loading}
        onClick={toggle}
      >
        {playing ? (
          <PauseIcon fontSize="small" />
        ) : (
          <PlayArrowIcon fontSize="small" />
        )}
      </button>
      <button
        type="button"
        aria-label="Stop"
        disabled={!request}
        onClick={stop}
      >
        <StopIcon fontSize="small" />
      </button>
      <span className="music-player-time">
        {time(position)} / {time(length)}
      </span>
      <input
        type="range"
        aria-label="Playback progress"
        min={0}
        max={length || 1}
        step={0.1}
        value={Math.min(position, length)}
        disabled={!length || loading}
        onChange={(event) => {
          const value = Number(event.target.value);
          audioRef.current!.currentTime = value;
          setPosition(value);
        }}
      />
      <label className="music-player-volume" htmlFor="music-volume">
        <VolumeUpIcon fontSize="small" />
        <input
          type="range"
          id="music-volume"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => {
            const value = Number(event.target.value);
            audioRef.current!.volume = value;
            setVolume(value);
          }}
        />
      </label>
      {error && (
        <div className="music-player-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
