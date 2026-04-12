import type {
  AliceUIExtensionApi,
  PluginClientExport,
} from '../../system/web-ui/client/types/index.js';

type ReactModule = typeof import('react');

type MoodApiResponse = {
  mood?: string;
  face?: string;
};

type MoodWidgetState = {
  mood: string;
  face: string;
};

const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

if (!React) {
  throw new Error(
    'Mood web UI extension requires globalThis.React to be available.'
  );
}

function normalizeMoodClass(mood: string): string {
  const normalizedMood = String(mood || 'neutral')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  return normalizedMood || 'neutral';
}

function useMood(): MoodWidgetState {
  const [state, setState] = React.useState<MoodWidgetState>({
    mood: 'neutral',
    face: '(-_-)',
  });
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
        throw new Error(
          `Mood API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as MoodApiResponse;
      setState({
        mood: data.mood ?? 'neutral',
        face: data.face ?? '(-_-)',
      });
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

  return {
    mood: normalizeMoodClass(state.mood),
    face: state.face,
  };
}

function MoodWidget() {
  const { mood, face } = useMood();

  return (
    <div
      id="mood-box"
      className={`mood-widget mood-widget--${mood}`}
      title={`Current mood: ${mood} ${face}`}
    >
      <pre>{face}</pre>
    </div>
  );
}

const moodUiExtension: PluginClientExport = {
  onAliceUIReady(api: AliceUIExtensionApi) {
    api.registerComponent('sidebar-top', MoodWidget);
  },
};

export default moodUiExtension;
