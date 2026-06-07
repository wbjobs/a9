export async function loadShader(filename: string): Promise<string> {
  const response = await fetch(`/shaders/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to load shader: ${filename}`);
  }
  return response.text();
}
