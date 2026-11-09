import { degreesToSteps, nearestEquivalent } from '@core/turntableMath';

// Makes the table follow a dragged angle: one move at a time, then on to the latest target
export const createAngleFollower = (table) => {
  let wanted = null;
  let running = false;
  let lastError = null;

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (wanted !== null && table.state.connected) {
        const rev = table.state.stepsPerRev;
        const steps = nearestEquivalent(degreesToSteps(wanted, rev), table.state.position ?? 0, rev);
        wanted = null;
        if (steps !== table.state.position) await table.moveTo(steps);
      }
    } catch (err) {
      lastError = err;
      wanted = null;
      throw err;
    } finally {
      running = false;
    }
  };

  return {
    setTarget(degrees) {
      wanted = ((Number(degrees) % 360) + 360) % 360;
      return pump();
    },
    get busy() {
      return running;
    },
    get lastError() {
      return lastError;
    },
  };
};
