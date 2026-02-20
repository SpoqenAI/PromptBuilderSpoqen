export function customAlert(message: string): Promise<void> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200';

        const dialog = document.createElement('div');
        dialog.className = 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200';

        const messageEl = document.createElement('p');
        messageEl.className = 'text-zinc-900 dark:text-zinc-100 mb-6';
        messageEl.textContent = message;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex justify-end';

        const okBtn = document.createElement('button');
        okBtn.className = 'px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors';
        okBtn.textContent = 'OK';

        const cleanup = () => {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', handleKeyDown);
            resolve();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };

        okBtn.addEventListener('click', cleanup);
        document.addEventListener('keydown', handleKeyDown);

        buttonContainer.appendChild(okBtn);
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        okBtn.focus({ preventScroll: true });
    });
}

export function customConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200';

        const dialog = document.createElement('div');
        dialog.className = 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200';

        const messageEl = document.createElement('p');
        messageEl.className = 'text-zinc-900 dark:text-zinc-100 mb-6';
        messageEl.textContent = message;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex justify-end gap-3';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors';
        cancelBtn.textContent = 'Cancel';

        const okBtn = document.createElement('button');
        okBtn.className = 'px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors';
        okBtn.textContent = 'Confirm';

        const cleanup = (result: boolean) => {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', handleKeyDown);
            resolve(result);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                cleanup(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(false);
            }
        };

        cancelBtn.addEventListener('click', () => cleanup(false));
        okBtn.addEventListener('click', () => cleanup(true));
        document.addEventListener('keydown', handleKeyDown);

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(okBtn);
        dialog.appendChild(messageEl);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        cancelBtn.focus({ preventScroll: true });
    });
}

export function customPrompt(message: string, defaultValue: string = ''): Promise<string | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200';

        const dialog = document.createElement('div');
        dialog.className = 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200';

        const messageEl = document.createElement('label');
        messageEl.className = 'block text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2';
        messageEl.textContent = message;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.className = 'w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white text-zinc-900 dark:text-zinc-100 mb-6';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex justify-end gap-3';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors';
        cancelBtn.textContent = 'Cancel';

        const okBtn = document.createElement('button');
        okBtn.className = 'px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors';
        okBtn.textContent = 'OK';

        const cleanup = (result: string | null) => {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', handleKeyDown);
            resolve(result);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                cleanup(input.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(null);
            }
        };

        cancelBtn.addEventListener('click', () => cleanup(null));
        okBtn.addEventListener('click', () => cleanup(input.value));
        document.addEventListener('keydown', handleKeyDown);

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(okBtn);
        dialog.appendChild(messageEl);
        dialog.appendChild(input);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Select all text in input and focus it
        input.focus({ preventScroll: true });
        input.select();
    });
}
