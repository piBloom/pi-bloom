export interface BloomSessionLike {
	alive: boolean;
	spawn(): Promise<void>;
	sendMessage(text: string): Promise<void>;
	dispose(): void;
}
