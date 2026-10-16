import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../app/gameStore';
import { registerPhotoCapture, usePhotoStore } from '../app/photoStore';
import { GameRuntime } from '../game/GameRuntime';
import { isWebGLAvailable } from '../game/webgl';
import { sceneFactories } from '../scenes/registry';
import { StatusScreen } from './StatusScreen';

type Phase = 'loading' | 'ready' | 'unsupported' | 'context-lost' | 'error';

export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (isWebGLAvailable() ? 'loading' : 'unsupported'));
  const [errorMessage, setErrorMessage] = useState('');
  const location = useGameStore((s) => s.currentLocation);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isWebGLAvailable()) return;
    let runtime: GameRuntime;
    try {
      runtime = new GameRuntime(host, sceneFactories, {
        onFirstFrame: () => setPhase('ready'),
        onContextLost: () => setPhase('context-lost'),
      });
      runtime.setLocation(useGameStore.getState().currentLocation);
      runtime.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queueMicrotask(() => {
        setErrorMessage(message);
        setPhase('error');
      });
      return;
    }
    runtimeRef.current = runtime;
    registerPhotoCapture(() => runtime.capture());
    const syncPhoto = (p: { active: boolean; view: Parameters<GameRuntime['setPhoto']>[0] }) =>
      runtime.setPhoto(p.active ? p.view : null);
    syncPhoto(usePhotoStore.getState());
    const offPhoto = usePhotoStore.subscribe(syncPhoto);
    return () => {
      offPhoto();
      registerPhotoCapture(null);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setLocation(location);
  }, [location]);

  const reload = { label: 'Reload', onClick: () => window.location.reload() };
  return (
    <div className="viewport" ref={hostRef}>
      {phase === 'loading' && <StatusScreen kind="loading" title="Starting renderer…" />}
      {phase === 'unsupported' && (
        <StatusScreen kind="unsupported" title="WebGL 2 is not available">
          Rocketworks needs a browser with WebGL 2 and hardware acceleration enabled. Try an
          up-to-date Chrome, Edge, Firefox or Safari, and check that graphics acceleration is turned
          on.
        </StatusScreen>
      )}
      {phase === 'context-lost' && (
        <StatusScreen kind="error" title="Graphics context lost" action={reload}>
          The GPU reset or ran out of resources. Your progress is kept; reload to continue.
        </StatusScreen>
      )}
      {phase === 'error' && (
        <StatusScreen kind="error" title="Could not start the 3D view" action={reload}>
          {errorMessage}
        </StatusScreen>
      )}
    </div>
  );
}
