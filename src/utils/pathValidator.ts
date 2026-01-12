import path from "path";
import fs from "fs";

/**
 * List of directories that should NEVER contain Rust modules.
 * These are system/build directories that should be completely ignored.
 */
const BLACKLISTED_DIRS = [
    ".git",
    "target",
    "node_modules",
    ".vscode",
    ".idea",
    "out",
    "dist",
    "build",
    ".cargo",
    ".rustup",
    "deps",
    "incremental"
];

/**
 * Checks if a path contains any blacklisted directory.
 * @param {string} filePath - The file path to check.
 * @returns {boolean} True if the path should be ignored.
 */
export function isBlacklistedPath(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const pathParts = normalizedPath.split("/");
    
    return pathParts.some(part => {
        // Check exact matches with blacklisted dirs
        if (BLACKLISTED_DIRS.includes(part)) {
            return true;
        }
        
        // Ignore hidden directories (except .rautomod file)
        if (part.startsWith(".") && part !== ".rautomod") {
            return true;
        }
        
        return false;
    });
}

/**
 * Finds the Rust project root by searching for a `Cargo.toml` file.
 * Starts from the given path and moves upwards through parent directories.
 * @param {string} startPath - The initial path to start the search from.
 * @returns {string | null} The path to the project root if found, otherwise null.
 */
export function findCargoRoot(startPath: string): string | null {
    // Determine if startPath is a directory or file
    let currentPath: string;
    try {
        const stats = fs.statSync(startPath);
        currentPath = stats.isDirectory() ? startPath : path.dirname(startPath);
    } catch {
        // If stat fails, assume it's a file path
        currentPath = path.dirname(startPath);
    }
    
    // Limit search depth to prevent infinite loops
    let depth = 0;
    const maxDepth = 20;
    
    while (currentPath !== path.dirname(currentPath) && depth < maxDepth) {
        const cargoTomlPath = path.join(currentPath, "Cargo.toml");
        
        if (fs.existsSync(cargoTomlPath)) {
            return currentPath;
        }
        
        currentPath = path.dirname(currentPath);
        depth++;
    }
    
    return null;
}

/**
 * Validates if a file path is within a valid Rust project and not in a blacklisted directory.
 * @param {string} filePath - The file path to validate.
 * @returns {boolean} True if the path is valid for Rust module operations.
 */
export function isValidRustPath(filePath: string): boolean {
    // First check: is it in a blacklisted directory?
    if (isBlacklistedPath(filePath)) {
        console.log(`RUST AUTOMOD: Ignoring blacklisted path: ${filePath}`);
        return false;
    }
    
    // Second check: is it within a Rust project?
    const cargoRoot = findCargoRoot(filePath);
    if (!cargoRoot) {
        console.log(`RUST AUTOMOD: No Cargo.toml found for: ${filePath}`);
        return false;
    }
    
    // Third check: ensure the file is actually within the project bounds
    const normalizedFilePath = path.normalize(filePath);
    const normalizedCargoRoot = path.normalize(cargoRoot);
    
    if (!normalizedFilePath.startsWith(normalizedCargoRoot)) {
        console.log(`RUST AUTOMOD: File outside project root: ${filePath}`);
        return false;
    }
    
    return true;
}

/**
 * Checks if a directory should be monitored for Rust module changes.
 * This is a more lenient check than isValidRustPath - it allows directories
 * that might eventually contain Rust code, but still blocks obviously wrong paths.
 * @param {string} dirPath - The directory path to check.
 * @returns {boolean} True if the directory should be monitored.
 */
export function shouldMonitorDirectory(dirPath: string): boolean {
    // Always block blacklisted directories
    if (isBlacklistedPath(dirPath)) {
        return false;
    }
    
    // Check if we're in a Rust workspace
    const cargoRoot = findCargoRoot(dirPath);
    return cargoRoot !== null;
}

/**
 * Gets a user-friendly error message explaining why a path was rejected.
 * @param {string} filePath - The rejected file path.
 * @returns {string} A descriptive error message.
 */
export function getPathRejectionReason(filePath: string): string {
    if (isBlacklistedPath(filePath)) {
        const normalizedPath = filePath.replace(/\\/g, "/");
        const pathParts = normalizedPath.split("/");
        const blacklistedPart = pathParts.find(part => 
            BLACKLISTED_DIRS.includes(part) || 
            (part.startsWith(".") && part !== ".rautomod")
        );
        
        return `File is in a system/build directory (${blacklistedPart}) that should not contain Rust modules`;
    }
    
    if (!findCargoRoot(filePath)) {
        return "File is not within a Rust project (no Cargo.toml found in parent directories)";
    }
    
    return "Unknown reason";
}