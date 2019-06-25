import { promisify } from 'bluebird';
import { promises as fs, remove } from 'fs-extra';
import { keys } from 'lodash';
import { dirname, join } from 'path';
import { Release } from '../artifacts-store';

export class LocalArchiveStoreAdapter {
	private readonly path: string;

	public constructor(path: string) {
		this.path = path;
	}

	async write(release: Release): Promise<void> {
		// Remove everything from path
		await this.removeAll();
		// write new release
		for (const filePath of keys(release)) {
			await this.putFile(filePath, release[filePath]);
		}
	}

	private async removeAll(): Promise<void> {
		try {
			const files = await fs.readdir(this.path);
			for (const file of files) {
				await remove(join(this.path, file));
			}
		} catch (e) {
			// ignore missing folders/paths
			if (e.code !== 'ENOENT') {
				throw e;
			}
		}
	}

	private async putFile(path: string, data: string) {
		await fs.mkdir(join(this.path, dirname(path)), { recursive: true });
		return await fs.writeFile(join(this.path, path), data);
	}
}