const loadedShaders = new Map<string, string>();

async function loadRawShader(filename: string): Promise<string> {
  if (loadedShaders.has(filename)) {
    return loadedShaders.get(filename)!;
  }
  const response = await fetch(`/shaders/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to load shader: ${filename}`);
  }
  const content = await response.text();
  loadedShaders.set(filename, content);
  return content;
}

export async function loadShader(filename: string, visited: Set<string> = new Set()): Promise<string> {
  if (visited.has(filename)) {
    throw new Error(`Circular include detected in shader: ${filename}`);
  }
  visited.add(filename);
  
  let content = await loadRawShader(filename);
  
  const includeRegex = /^#include\s+"([^"]+)"\s*$/gm;
  let match;
  
  while ((match = includeRegex.exec(content)) !== null) {
    const includeFile = match[1];
    const includeContent = await loadShader(includeFile, new Set(visited));
    content = content.replace(match[0], includeContent);
    includeRegex.lastIndex = 0;
  }
  
  return content;
}
