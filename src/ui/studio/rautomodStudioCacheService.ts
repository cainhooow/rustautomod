let studioCacheVersion = 0;

export function getRautomodStudioCacheVersion(): number {
    return studioCacheVersion;
}

export function invalidateRautomodStudioCaches(): void {
    studioCacheVersion += 1;
}
