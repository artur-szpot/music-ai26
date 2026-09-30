/* eslint react/require-default-props: ["error", { "functions": "defaultArguments" }] */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Ref } from 'react';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import type { TrackSummary } from '../main/musicCatalog';

export type PlaybackRequest = {
  track: TrackSummary;
  sequence: number;
  queue?: TrackSummary[];
  startPositionSeconds?: number;
  autoplay?: boolean;
};

const progressSaveIntervalMs = 5000;

function time(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export type MusicPlayerHandle = {
  togglePlayback: () => void;
};

export default function MusicPlayer({
  request,
  initialVolume,
  onPlayingTrackChange,
  onRandomTrack,
  ref = undefined,
}: {
  request: PlaybackRequest | null;
  initialVolume: number;
  onPlayingTrackChange: (trackId: number) => void;
  onRandomTrack: (() => Promise<TrackSummary | null>) | undefined;
  ref?: Ref<MusicPlayerHandle>;
}) {
  const startingVolume = initialVolume;
  const audioRef = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const activeRequest = useRef<PlaybackRequest | null>(null);
  const randomTrackRef = useRef(onRandomTrack);
  const continuousRandomRef = useRef(false);
  const randomRequestSequence = useRef(0);
  const pendingRandomRequest = useRef<number | null>(null);
  const queueIndex = useRef(0);
  const skippedCount = useRef(0);
  const failedTracks = useRef(new Set<string>());
  const activeTrackRef = useRef<TrackSummary | null>(null);
  const pendingRestorePosition = useRef<number | null>(null);
  const lastProgressSave = useRef(0);
  const volumeTouched = useRef(false);
  const volumeRef = useRef(startingVolume);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTrack, setActiveTrack] = useState<TrackSummary | null>(null);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolume] = useState(startingVolume);
  const [error, setError] = useState('');
  const [continuousRandom, setContinuousRandom] = useState(false);
  randomTrackRef.current = onRandomTrack;

  const persistState = useCallback(
    (
      trackId: number | null,
      positionSeconds: number,
      savedVolume = volumeRef.current,
    ) => {
      lastProgressSave.current = Date.now();
      window.music
        .savePlaybackState({ trackId, positionSeconds, volume: savedVolume })
        .then((result) => {
          if (!result.ok) setError(result.error.message);
          return undefined;
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not save playback state.',
          );
        });
    },
    [],
  );

  const playAtRef = useRef<
    (playbackRequest: PlaybackRequest, index: number, token: number) => void
  >(() => {});
  const failTrack = useCallback(
    (
      playbackRequest: PlaybackRequest,
      index: number,
      token: number,
      cause: unknown,
    ) => {
      if (generation.current !== token) return;
      const { queue } = playbackRequest;
      if (!queue) {
        setPlaying(false);
        setLoading(false);
        setError(
          cause instanceof Error ? cause.message : 'Could not play this track.',
        );
        return;
      }
      const failureKey = `${token}:${index}`;
      if (failedTracks.current.has(failureKey)) return;
      failedTracks.current.add(failureKey);
      skippedCount.current += 1;
      const remaining = queue.length - index - 1;
      if (remaining > 0) {
        setError(
          `Skipped ${skippedCount.current} unavailable playlist track${skippedCount.current === 1 ? '' : 's'}.`,
        );
        playAtRef.current?.(playbackRequest, index + 1, token);
      } else {
        setPlaying(false);
        setLoading(false);
        setError(
          `Skipped ${skippedCount.current} unavailable playlist track${skippedCount.current === 1 ? '' : 's'}. ${
            cause instanceof Error
              ? cause.message
              : 'Could not play the final track.'
          }`,
        );
      }
    },
    [],
  );
  const playAt = useCallback(
    async (playbackRequest: PlaybackRequest, index: number, token: number) => {
      if (generation.current !== token) return;
      const { queue } = playbackRequest;
      const track = queue ? queue[index] : playbackRequest.track;
      if (!track) {
        setPlaying(false);
        setLoading(false);
        return;
      }
      queueIndex.current = index;
      setActiveTrack(track);
      activeTrackRef.current = track;
      setLoading(true);
      const startPosition =
        index === 0 ? (playbackRequest.startPositionSeconds ?? 0) : 0;
      pendingRestorePosition.current =
        index === 0 && startPosition > 0 ? startPosition : null;
      setPosition(startPosition);
      persistState(track.id, startPosition);
      if (track.status === 'missing') {
        failTrack(
          playbackRequest,
          index,
          token,
          new Error('Track is marked missing.'),
        );
        return;
      }
      const audio = audioRef.current!;
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        setPosition(0);
        setLength(0);
        audio.volume = volumeRef.current;
        const result = await window.music.playbackSource(track.id);
        if (generation.current !== token) return;
        if (!result.ok) throw new Error(result.error.message);
        audio.src = result.data.url;
        audio.load();
        if (playbackRequest.autoplay !== false) await audio.play();
      } catch (cause) {
        failTrack(playbackRequest, index, token, cause);
      } finally {
        if (
          generation.current === token &&
          queueIndex.current === index &&
          !failedTracks.current.has(`${token}:${index}`)
        ) {
          setLoading(false);
        }
      }
    },
    [failTrack, persistState],
  );
  const requestPlayAt = useCallback(
    (playbackRequest: PlaybackRequest, index: number, token: number) => {
      playAt(playbackRequest, index, token).catch((cause: unknown) =>
        failTrack(playbackRequest, index, token, cause),
      );
    },
    [failTrack, playAt],
  );
  playAtRef.current = requestPlayAt;

  const startRandomTrack = useCallback(
    async (token: number) => {
      if (generation.current !== token || !continuousRandomRef.current) return;
      const chooseTrack = randomTrackRef.current;
      if (!chooseTrack) {
        setLoading(false);
        setError('Random playback is unavailable.');
        return;
      }
      randomRequestSequence.current += 1;
      const randomRequest = randomRequestSequence.current;
      pendingRandomRequest.current = randomRequest;
      setPlaying(false);
      setLoading(true);
      setError('');
      try {
        const track = await chooseTrack();
        if (randomRequest !== randomRequestSequence.current) return;
        pendingRandomRequest.current = null;
        if (generation.current !== token || !continuousRandomRef.current)
          return;
        if (!track) {
          setLoading(false);
          setError('No playable tracks in the collection.');
          return;
        }
        const nextRequest: PlaybackRequest = {
          track,
          sequence: (activeRequest.current?.sequence ?? 0) + 1,
        };
        activeRequest.current = nextRequest;
        queueIndex.current = 0;
        skippedCount.current = 0;
        failedTracks.current.clear();
        requestPlayAt(nextRequest, 0, token);
      } catch (cause) {
        if (randomRequest !== randomRequestSequence.current) return;
        pendingRandomRequest.current = null;
        if (generation.current !== token || !continuousRandomRef.current)
          return;
        setLoading(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not play a random track.',
        );
      }
    },
    [requestPlayAt],
  );

  const requestRandomTrack = (token: number) => {
    startRandomTrack(token).catch((cause: unknown) => {
      setLoading(false);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not play a random track.',
      );
    });
  };

  useEffect(() => {
    const audio = audioRef.current!;
    generation.current += 1;
    const token = generation.current;
    activeRequest.current = request;
    queueIndex.current = 0;
    skippedCount.current = 0;
    failedTracks.current.clear();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setPlaying(false);
    setActiveTrack(request?.track ?? null);
    activeTrackRef.current = request?.track ?? null;
    pendingRestorePosition.current = null;
    setPosition(request?.startPositionSeconds ?? 0);
    setLength(0);
    setError('');
    setLoading(false);
    if (request) requestPlayAt(request, 0, token);
    return () => {
      const currentTrack = activeTrackRef.current;
      if (currentTrack) {
        persistState(
          currentTrack.id,
          audio.getAttribute('src')
            ? audio.currentTime
            : (request?.startPositionSeconds ?? 0),
        );
      }
      generation.current += 1;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [request, requestPlayAt, persistState]);

  useLayoutEffect(() => {
    if (!volumeTouched.current) {
      audioRef.current!.volume = startingVolume;
      volumeRef.current = startingVolume;
      setVolume(startingVolume);
    }
  }, [startingVolume]);

  const toggle = () => {
    if (playing) {
      persistState(
        activeTrackRef.current?.id ?? null,
        audioRef.current!.currentTime,
      );
      audioRef.current!.pause();
    } else if (activeRequest.current) {
      const audio = audioRef.current!;
      if (audio.getAttribute('src')) {
        audio.play().catch((cause: unknown) => {
          const currentRequest = activeRequest.current;
          if (currentRequest) {
            failTrack(
              currentRequest,
              queueIndex.current,
              generation.current,
              cause,
            );
          }
        });
      } else {
        requestPlayAt(
          activeRequest.current,
          queueIndex.current,
          generation.current,
        );
      }
    }
  };

  useImperativeHandle(ref, () => ({
    togglePlayback: () => {
      if (!loading) toggle();
    },
  }));

  const stop = () => {
    generation.current += 1;
    const audio = audioRef.current!;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.currentTime = 0;
    setPlaying(false);
    setLoading(false);
    setPosition(0);
    if (activeTrackRef.current) persistState(activeTrackRef.current.id, 0);
  };

  const toggleContinuousRandom = () => {
    const enabled = !continuousRandomRef.current;
    continuousRandomRef.current = enabled;
    setContinuousRandom(enabled);
    if (!enabled && pendingRandomRequest.current !== null) {
      randomRequestSequence.current += 1;
      pendingRandomRequest.current = null;
      setLoading(false);
    }
    if (
      enabled &&
      (!activeTrackRef.current ||
        (!loading && !audioRef.current!.getAttribute('src')))
    ) {
      requestRandomTrack(generation.current);
    }
  };

  return (
    <section className="music-player" aria-label="Music player">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Local music files have no supplied caption tracks. */}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          const track = activeTrackRef.current;
          if (track) onPlayingTrackChange(track.id);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          const currentRequest = activeRequest.current;
          const currentTrack = activeTrackRef.current;
          if (currentTrack) persistState(currentTrack.id, 0);
          setPosition(0);
          audioRef.current!.currentTime = 0;
          if (continuousRandomRef.current) {
            requestRandomTrack(generation.current);
          } else if (currentRequest?.queue) {
            const nextIndex = queueIndex.current + 1;
            if (nextIndex < currentRequest.queue.length) {
              requestPlayAt(currentRequest, nextIndex, generation.current);
            } else {
              setPlaying(false);
            }
          } else setPlaying(false);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current!;
          setPosition(audio.currentTime);
          if (
            activeTrackRef.current &&
            Date.now() - lastProgressSave.current >= progressSaveIntervalMs
          ) {
            persistState(activeTrackRef.current.id, audio.currentTime);
          }
        }}
        onDurationChange={() => {
          const value = audioRef.current!.duration;
          setLength(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current!;
          const restorePosition = pendingRestorePosition.current;
          if (restorePosition !== null) {
            const value = Number.isFinite(audio.duration)
              ? Math.min(restorePosition, audio.duration)
              : restorePosition;
            audio.currentTime = value;
            pendingRestorePosition.current = null;
            setPosition(value);
            const currentTrack = activeTrackRef.current;
            if (currentTrack) persistState(currentTrack.id, value);
          }
          const value = audio.duration;
          setLength(Number.isFinite(value) && value > 0 ? value : 0);
        }}
        onError={() => {
          if (!audioRef.current?.getAttribute('src')) return;
          const currentRequest = activeRequest.current;
          if (currentRequest?.queue) {
            failTrack(
              currentRequest,
              queueIndex.current,
              generation.current,
              new Error(
                'Could not load this audio file. Check that it is available and uses a supported codec.',
              ),
            );
          } else {
            setPlaying(false);
            setLoading(false);
            setError(
              'Could not load this audio file. Check that it is available and uses a supported codec.',
            );
          }
        }}
      />
      <div className="music-player-title">
        {loading
          ? 'Loading...'
          : activeTrack?.title ||
            activeTrack?.path.split(/[\\/]/).pop() ||
            'No track playing'}
      </div>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={!activeTrack || loading}
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
        disabled={!activeTrack}
        onClick={stop}
      >
        <StopIcon fontSize="small" />
      </button>
      <button
        type="button"
        aria-label="Continuous random"
        aria-pressed={continuousRandom}
        title="Continuously play random tracks"
        disabled={!onRandomTrack}
        onClick={toggleContinuousRandom}
      >
        <ShuffleIcon fontSize="small" />
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
          persistState(activeTrackRef.current?.id ?? null, value);
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
            volumeTouched.current = true;
            volumeRef.current = value;
            audioRef.current!.volume = value;
            setVolume(value);
            persistState(
              activeTrackRef.current?.id ?? null,
              audioRef.current!.currentTime,
              value,
            );
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
