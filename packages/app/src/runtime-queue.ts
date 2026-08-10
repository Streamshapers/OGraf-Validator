interface KeyedRuntimeQueueItem {
    entry: { key: string };
}

/** Move a queued package to the front without changing the order of other packages. */
export function prioritizeRuntimeQueue<T extends KeyedRuntimeQueueItem>(
    queue: readonly T[],
    packageKey: string,
): T[] {
    const index = queue.findIndex((item) => item.entry.key === packageKey);
    if (index <= 0) return [...queue];

    const next = [...queue];
    const [selected] = next.splice(index, 1);
    if (selected) next.unshift(selected);
    return next;
}
