import { Tool } from '../lib/tool-system';
import { UserConfig } from '../lib/user-config';

const systemHealthCheckTool: Tool = {
  name: 'systemHealthCheck',
  description: 'Performs a health check on the system and returns a report.',
  systemPromptFragment: `Call systemHealthCheck ONLY for questions about the status of the computer you are running on. This includes general questions about how you are doing, as you are the computer. systemHealthCheck takes no parameters.`,
  callSignature: 'systemHealthCheck',
  toolResultPromptIntro: `You have just received the results of a call to the systemHealthCheck tool. The results are formatted as JSON with semantically meaningful field names, but since the permissions of the tool and the nature of the underlying system may vary, I cannot predict what fields will be present. Do your best with what you get. Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
  toolResultPromptOutro: () => {
    if (UserConfig.getConfig().tools.systemHealthCheck.mustMentionIfNetworkDown) {
      return `If the network connectivity status is "disconnected" or "limited," you MUST include that information in your response.`;
    }
    return '';
  },
  execute: async (_args: Record<string, string>) => { // systemHealthCheck takes no parameters, so we can ignore the args.
    // Here you would add the code to perform the actual system health check and retrieve the relevant information.
    // For the sake of this example, let's just return some dummy data.
    const dummyData = {
      cpuUsage: 45,
      cpuUsageUnit: '%',
      cpuTemperature: 65,
      cpuTemperatureUnit: '°C',
      ramAvailable: 64 * 1024, // 64 GB in MB (I swear I'm not just flexing my home setup here, honest ;-) )
      ramAvailableUnit: 'MB',
      ramUsage: 32 * 1024, // 32 GB in MB
      ramUsageUnit: 'MB',
      swapAvailable: 128 * 1024, // 128 GB in MB (When you've got 64 GB of RAM, you actually need this for hibernation to work, so it's reasonable here.)
      swapAvailableUnit: 'MB',
      swapUsage: 5 * 1024, // 5 GB in MB
      swapUsageUnit: 'MB',
      vramAvailable: 16 * 1024, // 16 GB in MB
      vramAvailableUnit: 'MB',
      vramUsage: 14 * 1024, // 14 GB in MB, we're supposed to be running mistral, locally, after all :-P
      vramUsageUnit: 'MB',
      gpuUsage: 99, // that's about right for mistral running on a AMD RX9070XT
      gpuUsageUnit: '%',
      gpuTemperature: 85, // Toasty!
      gpuTemperatureUnit: '°C',
      gpuPowerDraw: 150, // Whee!
      gpuPowerDrawUnit: 'W',
      filesystem: [
        {
          device: '/dev/nvme0n1p2 subvolumeid=256',
          mountPoint: '/',
          totalSpace: 2 * 1024 * 1024, // 2 TB in MB
          totalSpaceUnit: 'MB',
          type: 'btrfs',
          usage: 34,
          usageUnit: '%'
        },
        {
          device: '/dev/nvme0n1p2 subvolumeid=257',
          mountPoint: '/home',
          totalSpace: 2 * 1024 * 1024, // 2 TB in MB
          totalSpaceUnit: 'MB',
          type: 'btrfs',
          usage: 34,
          usageUnit: '%'
        },
        {
          device: '//nas/personal',
          mountPoint: '/home/user/network',
          totalSpace: null, // Unknown because not mounted yet.
          totalSpaceUnit: 'MB',
          type: 'smb',
          usage: null, // Unknown because not mounted yet.
          usageUnit: '%',
          removable: true
        },
        {
          device: '/dev/nvme0n2p1',
          mountPoint: '/home/user/Games',
          totalSpace: 1000 * 1024, // 1 TB in MB
          totalSpaceUnit: 'MB',
          type: 'ext4',
          usage: 92,
          usageUnit: '%'
        },
        {
          device: '/dev/sda1',
          mountPoint: '/media/Homework',
          totalSpace: 1 * 1024 * 1024, // 1 TB in MB
          totalSpaceUnit: 'MB',
          type: 'fat32',
          usage: 45,
          usageUnit: '%',
          removable: true
        }
      ],
      networkConnectivity: 'connected'
    };
    return JSON.stringify(dummyData);
  }
};

export default systemHealthCheckTool;