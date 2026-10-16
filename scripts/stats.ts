/**
 * The statistics the Gate (`scripts/gate.ts`) tests with: Student's t
 * distribution, sample and pooled variance, and Holm's correction. Pure
 * functions over numbers, with no dependency.
 */

/** ln Γ(x) for x > 0, by the Lanczos approximation (g = 7, nine terms). */
function lnGamma(x: number): number {
	const c = [
		0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
		12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
	];
	if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
	const z = x - 1;
	let sum = c[0] as number;
	for (let i = 1; i < c.length; i++) sum += (c[i] as number) / (z + i);
	const t = z + 7.5;
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** The continued fraction of the incomplete beta function, by Lentz's method. */
function betaFraction(a: number, b: number, x: number): number {
	const tiny = 1e-300;
	let c = 1;
	let d = 1 - ((a + b) * x) / (a + 1);
	if (Math.abs(d) < tiny) d = tiny;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= 300; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
		d = 1 + aa * d;
		if (Math.abs(d) < tiny) d = tiny;
		c = 1 + aa / c;
		if (Math.abs(c) < tiny) c = tiny;
		d = 1 / d;
		const step = d * c;
		h *= step;
		if (Math.abs(step - 1) < 1e-15) break;
	}
	return h;
}

/** The regularised incomplete beta function I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
	return x < (a + 1) / (a + b + 2)
		? (front * betaFraction(a, b, x)) / a
		: 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** P(T ≤ t) for Student's t with `df` degrees of freedom. */
export function studentCdf(t: number, df: number): number {
	const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
	return t > 0 ? 1 - tail : tail;
}

/** The t with P(T ≤ t) = p, for 0 < p < 1, found by bisection to 1e-10. */
export function studentQuantile(p: number, df: number): number {
	if (!(p > 0 && p < 1)) throw new Error(`a quantile needs 0 < p < 1, got ${p}`);
	let low = -1;
	let high = 1;
	while (studentCdf(low, df) > p) low *= 2;
	while (studentCdf(high, df) < p) high *= 2;
	while (high - low > 1e-10) {
		const mid = (low + high) / 2;
		if (studentCdf(mid, df) < p) low = mid;
		else high = mid;
	}
	return (low + high) / 2;
}

export function mean(values: number[]): number {
	return values.reduce((acc, value) => acc + value, 0) / values.length;
}

/** The sample variance, over n − 1; NaN for fewer than 2 values. */
export function sampleVariance(values: number[]): number {
	if (values.length < 2) return Number.NaN;
	const centre = mean(values);
	return values.reduce((acc, value) => acc + (value - centre) ** 2, 0) / (values.length - 1);
}

/**
 * The variance pooled over `batches`, each weighted by its n − 1, which sum
 * to the degrees of freedom. A batch of fewer than 2 values adds nothing;
 * with none left the variance is NaN and df 0.
 */
export function pooledVariance(batches: number[][]): { variance: number; df: number } {
	let sum = 0;
	let df = 0;
	for (const batch of batches) {
		if (batch.length < 2) continue;
		sum += (batch.length - 1) * sampleVariance(batch);
		df += batch.length - 1;
	}
	return { variance: df === 0 ? Number.NaN : sum / df, df };
}

/**
 * Holm's step-down correction at family level `alpha`: which of `pValues`
 * are rejected, in their given order. The i-th smallest is tested at
 * alpha / (m − i), and only while every smaller one was rejected.
 */
export function holm(pValues: number[], alpha: number): boolean[] {
	const order = pValues.map((p, at) => ({ p, at })).sort((a, b) => a.p - b.p);
	const rejected = pValues.map(() => false);
	for (const [rank, { p, at }] of order.entries()) {
		if (p > alpha / (pValues.length - rank)) break;
		rejected[at] = true;
	}
	return rejected;
}
