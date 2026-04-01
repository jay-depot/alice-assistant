import type { AliceUIExtensionApi, PluginClientExport } from '../web-ui/client/types/index.js';

type ReactModule = typeof import('react');

type MoodApiResponse = {
  mood?: string;
};

const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

if (!React) {
  throw new Error('Mood web UI extension requires globalThis.React to be available.');
}

function normalizeMoodClass(mood: string): string {
  const normalizedMood = String(mood || 'neutral').trim().toLowerCase().replace(/\s+/g, '-');
  return normalizedMood || 'neutral';
}

function useMood(): string {
  const [mood, setMood] = React.useState('neutral');
  const isPollingRef = React.useRef(false);

  const pollMood = React.useCallback(async () => {
    if (isPollingRef.current) {
      return;
    }

    isPollingRef.current = true;

    try {
      const response = await fetch('/api/mood', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Mood API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as MoodApiResponse;
      setMood(data.mood ?? 'neutral');
    } catch (error) {
      console.error('Failed to poll mood:', error);
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    let intervalId: number | null = null;

    const startPolling = () => {
      if (intervalId !== null) {
        return;
      }

      void pollMood();
      intervalId = window.setInterval(() => {
        void pollMood();
      }, 3000);
    };

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }

      startPolling();
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pollMood]);

  return normalizeMoodClass(mood);
}

function MoodWidget() {
  const moodClass = useMood();

  return (<div
    id="mood-box"
    className={`mood-widget mood-widget--${moodClass}`}
    title={`Current mood: ${moodClass}`}
  />
  );
}

const moodUiExtension: PluginClientExport = {
  onAliceUIReady(api: AliceUIExtensionApi) {
    api.registerComponent('sidebar-top', MoodWidget);
  },
};

export default moodUiExtension;
