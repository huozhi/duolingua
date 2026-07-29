#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
  char executable[PATH_MAX];
  char resolved[PATH_MAX];
  char macos[PATH_MAX];
  char contents[PATH_MAX];
  char node[PATH_MAX];
  char launcher[PATH_MAX];
  uint32_t size = sizeof(executable);

  if (_NSGetExecutablePath(executable, &size) != 0 ||
      realpath(executable, resolved) == NULL) {
    return 1;
  }

  snprintf(macos, sizeof(macos), "%s", dirname(resolved));
  snprintf(contents, sizeof(contents), "%s", dirname(macos));
  snprintf(node, sizeof(node), "%s/Resources/runtime/node", contents);
  snprintf(launcher, sizeof(launcher),
           "%s/Resources/launcher/desktop-launcher.mjs", contents);

  execl(node, node, launcher, NULL);
  return 1;
}
