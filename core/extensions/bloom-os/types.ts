// Extension-specific types for bloom-os

/** Parsed container info from podman ps JSON output. */
export interface ContainerInfo {
	Names?: string[];
	Status?: string;
	State?: string;
	Image?: string;
}

/** Update status persisted to disk by the update check timer. */
export interface UpdateStatus {
	available: boolean;
	checked: string;
	version?: string;
	notified?: boolean;
}
