import { MathUtils, Vector3, type Euler } from "three";

const PI2 = Math.PI * 2;

const clampByRadian = (
  value: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
) => {
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (hasMin && hasMax && min === max) return min;

  const newMin = hasMin ? MathUtils.euclideanModulo(min, PI2) : min;
  let newMax = hasMax ? MathUtils.euclideanModulo(max, PI2) : max;
  let newValue = MathUtils.euclideanModulo(value, PI2);

  if (hasMin && hasMax && newMin >= newMax) {
    newMax += PI2;
    if (newValue < Math.PI) newValue += PI2;
  }
  if (hasMax && newValue > newMax) newValue = newMax;
  else if (hasMin && newValue < newMin) newValue = newMin;
  return MathUtils.euclideanModulo(newValue, PI2);
};

export const clampVector3ByRadian = (value: Vector3 | Euler, min?: Vector3, max?: Vector3) =>
  value.set(
    clampByRadian(value.x, min?.x, max?.x),
    clampByRadian(value.y, min?.y, max?.y),
    clampByRadian(value.z, min?.z, max?.z)
  );
