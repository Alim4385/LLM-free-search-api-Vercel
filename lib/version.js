// v128: hər nəticədə hansı kodun işlədiyi görünsün (deploy olunub-olunmadığını təxmin etməmək üçün).
// ENGINE_VERSION əl ilə yenilənir; commit Vercel-dən gəlir (VERCEL_GIT_COMMIT_SHA), yoxdursa null.
export const ENGINE_VERSION = "v130";
export function engineInfo(env = (typeof process !== "undefined" ? process.env : {})) {
  const sha = String((env && env.VERCEL_GIT_COMMIT_SHA) || "").trim();
  return { engine_version: ENGINE_VERSION, commit: sha ? sha.slice(0, 7) : null };
}
