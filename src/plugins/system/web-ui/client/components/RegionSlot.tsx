import { useExtensionRegistry } from '../context/ExtensionContext.js';
import { classNames } from '../utils.js';
import type { UIRegion } from '../types/index.js';

interface RegionSlotProps {
  region: UIRegion;
  className?: string;
}

export function RegionSlot({ region, className }: RegionSlotProps) {
  const registry = useExtensionRegistry();
  const components = registry[region] ?? [];

  if (components.length === 0) {
    return null;
  }

  return (
    <div
      className={classNames('region-slot', `region-slot--${region}`, className)}
    >
      {components.map((Component, index) => (
        <Component key={`${region}-${index}`} />
      ))}
    </div>
  );
}
