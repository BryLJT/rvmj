import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { subscribeAuthenticatedChannel } from '../src/lib/supabase/realtime';

type SubscribeCallback = NonNullable<Parameters<RealtimeChannel['subscribe']>[0]>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushStartup() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function sessionResult(accessToken = 'authenticated-token') {
  return {
    data: { session: { access_token: accessToken } },
    error: null,
  };
}

describe('subscribeAuthenticatedChannel', () => {
  it('authenticates Realtime before building or subscribing the channel', async () => {
    const events: string[] = [];
    const restored = deferred<ReturnType<typeof sessionResult>>();
    const authenticated = deferred<void>();
    const channel = {
      subscribe: () => { events.push('subscribe'); return channel; },
    } as unknown as RealtimeChannel;
    const client = {
      auth: {
        getSession: () => {
          events.push('getSession');
          return restored.promise;
        },
      },
      realtime: {
        setAuth: (token: string) => {
          events.push(`setAuth:${token}`);
          return authenticated.promise;
        },
      },
      removeChannel: async () => 'ok',
    } as unknown as SupabaseClient;

    subscribeAuthenticatedChannel(
      client,
      'test-topic',
      () => { events.push('buildChannel'); return channel; },
      () => undefined,
    );

    expect(events).toEqual(['getSession']);

    restored.resolve(sessionResult());
    await flushStartup();

    expect(events).toEqual([
      'getSession',
      'setAuth:authenticated-token',
    ]);

    authenticated.resolve();
    await flushStartup();

    expect(events).toEqual([
      'getSession',
      'setAuth:authenticated-token',
      'buildChannel',
      'subscribe',
    ]);
  });

  it('reports CHANNEL_ERROR and never builds a channel when no session exists', async () => {
    const events: string[] = [];
    const statuses: Array<{ status: string; cause?: Error }> = [];
    const client = {
      auth: {
        getSession: async () => {
          events.push('getSession');
          return { data: { session: null }, error: null };
        },
      },
      realtime: {
        setAuth: async () => { events.push('setAuth'); },
      },
      removeChannel: async () => 'ok',
    } as unknown as SupabaseClient;

    subscribeAuthenticatedChannel(
      client,
      'test-topic',
      () => {
        events.push('buildChannel');
        return {} as RealtimeChannel;
      },
      (status, cause) => statuses.push({ status, cause }),
    );
    await flushStartup();

    expect(events).toEqual(['getSession']);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe('CHANNEL_ERROR');
    expect(statuses[0].cause?.message).toBe('A signed-in session is required for live updates.');
  });

  it('does not subscribe after cleanup wins the session-restoration race', async () => {
    const events: string[] = [];
    const statuses: string[] = [];
    const restored = deferred<ReturnType<typeof sessionResult>>();
    const client = {
      auth: {
        getSession: () => {
          events.push('getSession');
          return restored.promise;
        },
      },
      realtime: {
        setAuth: async () => { events.push('setAuth'); },
      },
      removeChannel: async () => 'ok',
    } as unknown as SupabaseClient;

    const stop = subscribeAuthenticatedChannel(
      client,
      'test-topic',
      () => {
        events.push('buildChannel');
        return {} as RealtimeChannel;
      },
      (status) => statuses.push(status),
    );
    stop();
    restored.resolve(sessionResult());
    await flushStartup();

    expect(events).toEqual(['getSession']);
    expect(statuses).toEqual([]);
  });

  it('does not subscribe after cleanup wins the token-attachment race', async () => {
    const events: string[] = [];
    const authenticated = deferred<void>();
    const client = {
      auth: {
        getSession: async () => {
          events.push('getSession');
          return sessionResult();
        },
      },
      realtime: {
        setAuth: () => {
          events.push('setAuth');
          return authenticated.promise;
        },
      },
      removeChannel: async () => 'ok',
    } as unknown as SupabaseClient;

    const stop = subscribeAuthenticatedChannel(
      client,
      'test-topic',
      () => {
        events.push('buildChannel');
        return {} as RealtimeChannel;
      },
      () => undefined,
    );
    await flushStartup();
    stop();
    authenticated.resolve();
    await flushStartup();

    expect(events).toEqual(['getSession', 'setAuth']);
  });

  it('removes an established channel and suppresses cleanup CLOSED callbacks', async () => {
    const events: string[] = [];
    const statuses: string[] = [];
    let subscribeCallback: SubscribeCallback | undefined;
    const channel = {
      subscribe: (callback?: SubscribeCallback) => {
        events.push('subscribe');
        subscribeCallback = callback;
        return channel;
      },
    } as unknown as RealtimeChannel;
    const client = {
      auth: {
        getSession: async () => {
          events.push('getSession');
          return sessionResult();
        },
      },
      realtime: {
        setAuth: async () => { events.push('setAuth'); },
      },
      removeChannel: async () => {
        events.push('removeChannel');
        subscribeCallback?.(REALTIME_SUBSCRIBE_STATES.CLOSED);
        return 'ok';
      },
    } as unknown as SupabaseClient;

    const stop = subscribeAuthenticatedChannel(
      client,
      'test-topic',
      () => { events.push('buildChannel'); return channel; },
      (status) => statuses.push(status),
    );
    await flushStartup();
    stop();
    await flushStartup();

    expect(events).toEqual([
      'getSession',
      'setAuth',
      'buildChannel',
      'subscribe',
      'removeChannel',
    ]);
    expect(statuses).toEqual([]);
  });

  it('waits for removal of the same topic before rebuilding it', async () => {
    const events: string[] = [];
    const removed = deferred<'ok'>();
    const firstChannel = {
      subscribe: () => { events.push('subscribe:first'); return firstChannel; },
    } as unknown as RealtimeChannel;
    const secondChannel = {
      subscribe: () => { events.push('subscribe:second'); return secondChannel; },
    } as unknown as RealtimeChannel;
    const client = {
      auth: { getSession: async () => sessionResult() },
      realtime: { setAuth: async () => undefined },
      removeChannel: () => {
        events.push('remove:first');
        return removed.promise;
      },
    } as unknown as SupabaseClient;

    const stopFirst = subscribeAuthenticatedChannel(
      client,
      'shared-topic',
      () => { events.push('build:first'); return firstChannel; },
      () => undefined,
    );
    await flushStartup();
    stopFirst();

    subscribeAuthenticatedChannel(
      client,
      'shared-topic',
      () => { events.push('build:second'); return secondChannel; },
      () => undefined,
    );
    await flushStartup();

    expect(events).toEqual(['build:first', 'subscribe:first', 'remove:first']);

    removed.resolve('ok');
    await flushStartup();

    expect(events).toEqual([
      'build:first',
      'subscribe:first',
      'remove:first',
      'build:second',
      'subscribe:second',
    ]);
  });
});
