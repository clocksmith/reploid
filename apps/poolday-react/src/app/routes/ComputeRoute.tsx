import { useState } from 'react';
import { createComputeServices } from '../../features/compute/infrastructure/hostCompute';
import { ComputePage } from '../../features/compute/presentation/ComputePage';

/** /compute: "Sequence provider" over this page's one contribution controller; sharing outlives a re-render. */
export function ComputeRoute() {
  const [services] = useState(createComputeServices);
  return <ComputePage services={services} />;
}
