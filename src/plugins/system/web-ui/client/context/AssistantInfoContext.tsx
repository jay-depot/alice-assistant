import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  fetchAssistantInfo,
  type AssistantInfo,
} from '../api/assistant-info.js';

const AssistantInfoContext = createContext<AssistantInfo>({
  assistantName: 'ALICE',
  displayName: 'A.L.I.C.E.',
});

export function AssistantInfoProvider({ children }: PropsWithChildren) {
  const [info, setInfo] = useState<AssistantInfo>({
    assistantName: 'ALICE',
    displayName: 'A.L.I.C.E.',
  });

  useEffect(() => {
    let isMounted = true;

    fetchAssistantInfo()
      .then(data => {
        if (isMounted) {
          setInfo(data);
          document.title = data.displayName;
        }
      })
      .catch(error => {
        console.error('Failed to fetch assistant info:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <AssistantInfoContext.Provider value={info}>
      {children}
    </AssistantInfoContext.Provider>
  );
}

export function useAssistantInfo(): AssistantInfo {
  return useContext(AssistantInfoContext);
}
