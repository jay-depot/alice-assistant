import { spawn, spawnSync } from 'node:child_process';
import { AlicePlugin } from '../../lib.js';

function hasNotifySend(): boolean {
  const check = spawnSync('which', ['notify-send'], { stdio: 'ignore' });
  return check.status === 0;
}

function sendDesktopNotification(notification: { title: string; message: string; source: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('notify-send', [notification.title, notification.message, '--app-name=ALICE', `--category=${notification.source}`], {
      stdio: 'ignore',
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`notify-send exited with code ${code}`));
    });
  });
}

const notificationsLibnotifyPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-libnotify',
    name: 'Notifications Libnotify Plugin',
    description: 'A notification sink plugin that uses libnotify via notify-send to send ' +
      'desktop notifications directly to the user without involving the LLM.',
    version: 'LATEST',
    dependencies: [
      { id: 'notifications-broker', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    if (process.platform !== 'linux') {
      throw new Error('Plugin notifications-libnotify requires Linux with notify-send available. Disable notifications-libnotify to continue.');
    }

    if (!hasNotifySend()) {
      throw new Error('Plugin notifications-libnotify requires the notify-send command. Install libnotify-bin or disable notifications-libnotify to continue.');
    }

    const { registerNotificationSink } = plugin.request('notifications-broker')!;

    await registerNotificationSink('notifications-libnotify', {
      sendNotification: async (notification) => {
        await sendDesktopNotification(notification);
      },
    });
  }
};

export default notificationsLibnotifyPlugin;
