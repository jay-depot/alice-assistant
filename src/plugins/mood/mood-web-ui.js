const React = globalThis.React;

if (!React) {
  throw new Error('Mood web UI extension requires globalThis.React to be available.');
}

function normalizeMoodClass(mood) {
  const normalizedMood = String(mood || 'neutral').trim().toLowerCase().replace(/\s+/g, '-');
  return normalizedMood || 'neutral';
}

function useMood() {
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

      const data = await response.json();
      setMood(data.mood ?? 'neutral');
    } catch (error) {
      console.error('Failed to poll mood:', error);
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    let intervalId = null;

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

  return React.createElement('div', {
    id: 'mood-box',
    className: moodClass,
    title: moodClass,
  });
}

export default {
  onAliceUIReady(api) {
    api.registerComponent('sidebar-top', MoodWidget);
  },
};
