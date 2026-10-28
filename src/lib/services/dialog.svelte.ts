/**
 * Trax Vault Global Dialog Service (Svelte 5)
 *
 * Provides reactive custom confirmation and alert modals,
 * replacing native browser confirm() and alert() dialogs.
 */

export interface DialogOptions {
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
	icon?: 'trash' | 'warning' | 'info' | 'help';
}

interface DialogState {
	isOpen: boolean;
	title: string;
	message: string;
	confirmText: string;
	cancelText: string;
	danger: boolean;
	isAlert: boolean;
	icon: 'trash' | 'warning' | 'info' | 'help';
	resolve: ((value: boolean) => void) | null;
}

class DialogService {
	state = $state<DialogState>({
		isOpen: false,
		title: 'Confirm Action',
		message: '',
		confirmText: 'Confirm',
		cancelText: 'Cancel',
		danger: false,
		isAlert: false,
		icon: 'warning',
		resolve: null
	});

	/**
	 * Displays a custom confirmation modal and awaits user action.
	 * Returns true if confirmed, false if cancelled.
	 */
	confirm(options: string | DialogOptions): Promise<boolean> {
		const opts: DialogOptions = typeof options === 'string' ? { message: options } : options;
		return new Promise((resolve) => {
			this.state.isOpen = true;
			this.state.title = opts.title ?? (opts.danger ? 'Confirm Action' : 'Are you sure?');
			this.state.message = opts.message;
			this.state.confirmText = opts.confirmText ?? (opts.danger ? 'Delete' : 'Confirm');
			this.state.cancelText = opts.cancelText ?? 'Cancel';
			this.state.danger = opts.danger ?? false;
			this.state.isAlert = false;
			this.state.icon = opts.icon ?? (opts.danger ? 'trash' : 'warning');
			this.state.resolve = resolve;
		});
	}

	/**
	 * Displays a custom alert modal and awaits dismissal.
	 */
	alert(message: string, title: string = 'Notice'): Promise<void> {
		return new Promise((resolve) => {
			this.state.isOpen = true;
			this.state.title = title;
			this.state.message = message;
			this.state.confirmText = 'OK';
			this.state.cancelText = '';
			this.state.danger = false;
			this.state.isAlert = true;
			this.state.icon = 'info';
			this.state.resolve = () => resolve();
		});
	}

	handleConfirm() {
		if (this.state.resolve) {
			this.state.resolve(true);
		}
		this.close();
	}

	handleCancel() {
		if (this.state.resolve) {
			this.state.resolve(false);
		}
		this.close();
	}

	close() {
		this.state.isOpen = false;
		this.state.resolve = null;
	}
}

export const dialog = new DialogService();
export const confirmAction = (options: string | DialogOptions) => dialog.confirm(options);
export const alertAction = (message: string, title?: string) => dialog.alert(message, title);
