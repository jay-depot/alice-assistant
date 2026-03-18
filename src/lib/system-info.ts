import os from "os";
import path from "path";
import fs from "fs";
import childProcess from 'child_process';

export const getSystemInfo = (() => {
  // The goal here is to give the LLM roughly the same information [neo|fast]fetch would display to a user, without the logo :-P
  const sysInfoCache: Record<string, string | number | boolean | null> = {};

  return async () => {
    // First we fetch the operating system name
    if (!sysInfoCache.os) {
      const lookupTable: Record<string, string> = {
        aix: 'AIX',
        freebsd: 'FreeBSD',
        openbsd: 'OpenBSD',
        sunos: 'Solaris',
        win32: 'Windows',
        darwin: 'macOS',
        linux: 'Linux'
      };
      const platform = os.platform();
      sysInfoCache.os = lookupTable[platform] || 'Unknown';
    }

    if(!sysInfoCache.distribution) {
      // We're going to use the term "distribution" here in the usual sense for linux, and to mean the version of MacOS or Windows
      // So Windows 10 is a "distribution" of Windows, and MacOS Sonoma is a "distribution" of MacOS.
      // Hopefully the LLM catches on to this slight abuse of terminology without help. Or maybe it'll just tell the user they should switch to Linux.
      // Either way, mission accomplished.
      switch (sysInfoCache.os) {
        case 'Windows':
          sysInfoCache.distribution = os.release(); // This will give us the version number, which is probably good enough for our purposes. Windows doesn't have "distributions" in the same way Linux does, so we'll just use the version number as a proxy.
          break;
        case 'macOS':
          sysInfoCache.distribution = os.release(); // This will give us the version number, which is probably good enough for our purposes. MacOS doesn't have "distributions" in the same way Linux does, so we'll just use the version number as a proxy.
          break;
        case 'Linux': {
          // For linux, we can actually get the distribution name, which is nice. We'll use the /etc/os-release file, which is pretty standard across distributions.
          // TODO: There are definitely distros this doesn't work for, and we should handle them.
          const osReleasePath = '/etc/os-release';
          if (fs.existsSync(osReleasePath)) {
            const osReleaseData = fs.readFileSync(osReleasePath, 'utf-8');
            const lines = osReleaseData.split('\n');
            for (const line of lines) {
              if (line.startsWith('PRETTY_NAME=')) {
                sysInfoCache.distribution = line.split('=')[1].replace(/"/g, ''); // Remove the quotes around the value
                break;
              }
            }
          } else {
            sysInfoCache.distribution = 'Unknown Linux Distribution';
          }
          break;
        }
        default:
          sysInfoCache.distribution = 'Unknown';
      } 
    }

    if (!sysInfoCache.packageManager) {
      // Probe the filesystem to see which package managers actually exist on the system.
      const packageManagers = [
        { name: 'apt', path: '/usr/bin/apt' },
        { name: 'dnf', path: '/usr/bin/dnf' },
        { name: 'pacman', path: '/usr/bin/pacman' },
        { name: 'zypper', path: '/usr/bin/zypper' },
        { name: 'emerge', path: '/usr/bin/emerge' },
        { name: 'xbps-install', path: '/usr/bin/xbps-install' },
        { name: 'apk', path: '/usr/bin/apk' },
        { name: 'brew', path: '/usr/local/bin/brew' }, // Homebrew on macOS typically installs to /usr/local, but on Apple Silicon it installs to /opt/homebrew, so we should check both places.
        { name: 'brew', path: '/opt/homebrew/bin/brew' },
        { name: 'flatpak', path: '/usr/bin/flatpak' },
        { name: 'flatpak', path: '/usr/bin/flatpak-spawn-1.0' },
        { name: 'snap', path: '/usr/bin/snap-cli' },
        { name: 'snap', path: '/usr/bin/snap-gtk' },
      ];
      const detectedPackageManagers: string[] = [];
      for (const pm of packageManagers) {
        if (fs.existsSync(pm.path)) {
          detectedPackageManagers.push(pm.name);
        }
      }
      const deduplicatedPackageManagers = new Set(detectedPackageManagers);
      if (Array.from(deduplicatedPackageManagers).length > 0) {
        sysInfoCache.packageManager = Array.from(deduplicatedPackageManagers).join(', ');
      } else {
        sysInfoCache.packageManager = 'Unknown';
      }
    }

    if (!sysInfoCache.gpuModel) {
      // We can get the GPU model on Linux by reading the /proc/driver/nvidia/gpus/ directory for Nvidia GPUs, and using lspci for AMD and Intel GPUs. 
      // On Windows and macOS, we won't bother, for now.
      // We also want to get the vram size if possible
      if (sysInfoCache.os === 'Linux') {
        const nvidiaGpuPath = '/proc/driver/nvidia/gpus/';
        if (fs.existsSync(nvidiaGpuPath)) {
          const gpuDirs = fs.readdirSync(nvidiaGpuPath);
          if (gpuDirs.length > 0) {
            const gpuInfoPath = path.join(nvidiaGpuPath, gpuDirs[0], 'information');
            if (fs.existsSync(gpuInfoPath)) {
              const gpuInfoData = fs.readFileSync(gpuInfoPath, 'utf-8');
              const lines = gpuInfoData.split('\n');
              for (const line of lines) {
                if (line.startsWith('Model:')) {
                  sysInfoCache.gpuModel = line.split(':')[1].trim();
                } else if (line.startsWith('Video Memory:')) {
                  const vramString = line.split(':')[1].trim();
                  const vramMatch = vramString.match(/(\d+)\s*MiB/);
                  if (vramMatch) {
                    sysInfoCache.vramSize = parseInt(vramMatch[1]) * 1024; // Convert MiB to KiB
                    sysInfoCache.vramSizeUnit = 'KB';
                  }
                }
              }
            }
          }
        } else {
          // For AMD and Intel GPUs, we'll use lspci and look for lines that mention VGA or 3D controllers. This is a bit more error-prone, but it's a start.
          const lspciPath = '/usr/bin/lspci';
          if (fs.existsSync(lspciPath)) {
            const lspciData = childProcess.execSync('lspci -nnk').toString();
            const lines = lspciData.split('\n');
            for (const line of lines) {
              if (line.toLowerCase().includes('vga compatible controller') || line.toLowerCase().includes('3d controller')) {
                const gpuModelMatch = line.match(/^\S+\s+(.+?)\s+\[/);
                if (gpuModelMatch) {
                  sysInfoCache.gpuModel = gpuModelMatch[1].trim();
                  break;
                }
              }
            }
          }
        }
      }
    }

    return { 
      ...sysInfoCache,
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      physicalCores: os.cpus().filter((cpu, index, self) => {
        return self.findIndex(c => c.model === cpu.model) === index;
      }).length,
      threadCount: os.cpus().length,
      totalMemory: os.totalmem(),
      totalMemoryUnit: 'bytes',
      uptime: os.uptime(),
      uptimeUnit: 'seconds',
      desktopEnvironment: process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || 'Unknown',
      windowManager: process.env.XDG_SESSION_DESKTOP || 'Unknown',
      graphicalServer: process.env.XDG_SESSION_TYPE || 'Unknown',
      displaySize: process.env.DISPLAY || 'Unknown',
      shell: process.env.SHELL || 'Unknown',
      terminal: process.env.TERM_PROGRAM || process.env.TERM || 'Unknown',
      kernel: sysInfoCache.os === 'Linux' ? os.release() : 'N/A',
      homeDirectory: os.homedir(),
      hostname: os.hostname(),
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    } as Record<string, string | number | boolean | null>;
  };
})();
