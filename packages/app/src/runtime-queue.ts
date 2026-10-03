interface KeyedRuntimeQueueItem {
    entry: { key: string };
    suite?: 'standard' | 'extended';
}

interface SuiteRuntimeQueueItem extends KeyedRuntimeQueueItem {
    suite: 'standard' | 'extended';
}

/** Explicit extended work follows its own pending standard check and the active job. */
export function enqueueRuntimeJob<T extends SuiteRuntimeQueueItem>(
    queue: readonly T[],
    item: T,
    priority = false,
): T[] {
    if (queue.some((queued) => queued.entry.key === item.entry.key && queued.suite === item.suite)) {
        return [...queue];
    }
    if (!priority) return [...queue, item];
    if (item.suite === 'standard') {
        const priorityEnd = extendedPriorityEnd(queue);
        return [...queue.slice(0, priorityEnd), item, ...queue.slice(priorityEnd)];
    }

    const prerequisite = queue.find((queued) => (
        queued.entry.key === item.entry.key && queued.suite === 'standard'
    ));
    return prerequisite
        ? [prerequisite, item, ...queue.filter((queued) => queued !== prerequisite)]
        : [item, ...queue];
}

/** Selection reorders automatic work after explicitly requested extended work. */
export function prioritizeRuntimeQueue<T extends KeyedRuntimeQueueItem>(
    queue: readonly T[],
    packageKey: string,
): T[] {
    const priorityEnd = extendedPriorityEnd(queue);
    const index = queue.findIndex((item, index) => index >= priorityEnd && item.entry.key === packageKey);
    if (index <= priorityEnd) return [...queue];

    const next = [...queue];
    const [selected] = next.splice(index, 1);
    if (selected) next.splice(priorityEnd, 0, selected);
    return next;
}

function extendedPriorityEnd(queue: readonly KeyedRuntimeQueueItem[]): number {
    return queue.reduce((end, item, index) => item.suite === 'extended' ? index + 1 : end, 0);
}
