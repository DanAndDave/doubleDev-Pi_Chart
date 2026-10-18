/** Loaded with `-e` just after a Run's pi-chart extension: see `scripts/run-url-set.ts`. */
export default function unsetRunUrl(): void {
	delete process.env.PICHART_DATABASE_URL;
}
