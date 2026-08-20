import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type SubscribeCallback = NonNullable<Parameters<RealtimeChannel['subscribe']>[0]>;

const pendingRemovals = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();

function removalFor(client: SupabaseClient, topic: string): Promise<void> | undefined {
  return pendingRemovals.get(client)?.get(topic);
}

function removeChannel(client: SupabaseClient, topic: string, channel: RealtimeChannel): void {
  const removal = client.removeChannel(channel).then(() => undefined, () => undefined);
  let byTopic = pendingRemovals.get(client);
  if (!byTopic) {
    byTopic = new Map();
    pendingRemovals.set(client, byTopic);
  }
  byTopic.set(topic, removal);

  void removal.then(() => {
    const current = pendingRemovals.get(client);
    if (current?.get(topic) !== removal) return;
    current.delete(topic);
    if (current.size === 0) pendingRemovals.delete(client);
  });
}

export function subscribeAuthenticatedChannel(
  client: SupabaseClient,
  topic: string,
  buildChannel: () => RealtimeChannel,
  onStatus: SubscribeCallback,
): () => void {
  let cancelled = false;
  let channel: RealtimeChannel | undefined;

  void (async () => {
    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (cancelled) return;
      if (error) throw error;
      if (!session) throw new Error('A signed-in session is required for live updates.');

      await client.realtime.setAuth(session.access_token);
      if (cancelled) return;

      // Supabase reuses a same-topic channel until removeChannel() has finished tearing it down.
      // Building sooner can return a channel in `leaving`, whose subscribe() call is a no-op.
      const previousRemoval = removalFor(client, topic);
      if (previousRemoval) await previousRemoval;
      if (cancelled) return;

      channel = buildChannel();
      channel.subscribe((status, cause) => {
        if (!cancelled) onStatus(status, cause);
      });
    } catch (cause) {
      if (cancelled) return;
      const error = cause instanceof Error
        ? cause
        : new Error('Could not authenticate live updates.');
      onStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, error);
    }
  })();

  return () => {
    cancelled = true;
    if (channel) removeChannel(client, topic, channel);
  };
}
