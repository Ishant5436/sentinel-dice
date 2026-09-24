import { useEffect, useState } from 'react';
import {
  connectGameToHost,
  observeGameContentSize,
  type GuestBridgeConnection,
  type HostApiV1,
  type HostSnapshotV1,
} from '@chain/casino-sdk/guest';

type SnapshotListener = (snapshot: HostSnapshotV1 | null) => void;

type HostBridge = {
  connection: GuestBridgeConnection;
  listeners: Set<SnapshotListener>;
  latest: HostSnapshotV1 | null;
};

let bridge: HostBridge | undefined;

function hostBridge(): HostBridge {
  if (bridge) return bridge;
  const listeners = new Set<SnapshotListener>();
  const created: HostBridge = {
    listeners,
    latest: null,
    connection: connectGameToHost({
      async setState(snapshot) {
        created.latest = snapshot;
        listeners.forEach(listener => listener(snapshot));
      },
    }),
  };
  bridge = created;
  return created;
}

export function useCasinoHost(): {
  hostApi: HostApiV1 | null;
  snapshot: HostSnapshotV1 | null;
} {
  const [hostApi, setHostApi] = useState<HostApiV1 | null>(null);
  const [snapshot, setSnapshot] = useState<HostSnapshotV1 | null>(null);

  useEffect(() => {
    const { connection, listeners, latest } = hostBridge();
    let mounted = true;
    listeners.add(setSnapshot);
    setSnapshot(latest);

    void connection.promise
      .then((parent: any) => {
        if (mounted) setHostApi(parent);
      })
      .catch((err: unknown) => {
        console.info('Standalone browser preview mode active:', err);
      });

    return () => {
      mounted = false;
      listeners.delete(setSnapshot);
    };
  }, []);

  useEffect(() => {
    if (!hostApi) return;
    const observer = observeGameContentSize(hostApi);
    return () => observer.disconnect();
  }, [hostApi]);

  return { hostApi, snapshot };
}
