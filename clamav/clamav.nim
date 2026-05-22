## clamav-handler — ClamAV VirusEvent orchestrator.
##
## Single binary with three subcommands, each meant to run under a different
## identity:
##
##   event   — invoked by clamd (as the `clamav` user) via the VirusEvent
##             directive. Reads CLAM_VIRUSEVENT_FILENAME / _VIRUSNAME from the
##             environment, checks the ignore list, and fans out a popup to
##             every graphical user session under /run/user.
##
##   notify  — invoked inside each graphical user's `systemd --user` session.
##             Shows a kdialog action chooser; on "Ignore", prompts for a
##             path + scope (file/folder); then dispatches to `action` via
##             passwordless sudo.
##
##   action  — invoked as root via sudo. Performs the privileged side effects:
##             quarantine (mv into /etc/clamav/quarantine), delete, or append
##             a line to /etc/clamav/ignore.list (flock-guarded).

import std/[os, osproc, strutils, strformat, posix, streams]
import docopt

const Doc = """
clamav-handler — ClamAV VirusEvent orchestrator.

Usage:
  clamav-handler install [<user>]
  clamav-handler event
  clamav-handler notify <file> <virus>
  clamav-handler action quarantine <file>
  clamav-handler action delete <file>
  clamav-handler action ignore (file|folder) <path>
  clamav-handler (-h | --help)
  clamav-handler --version

The <user> argument to `install` is the desktop login (or `%group`) that may
run `action *` via passwordless sudo. Defaults to $SUDO_USER if unset.

Options:
  -h --help     Show this screen.
  --version     Show version.
"""

const
  Self           = "/etc/clamav/clamav-handler"
  SudoersFile    = "/etc/sudoers.d/clamav-handler"
  IgnoreList     = "/etc/clamav/ignore.list"
  IgnoreLockFile = "/etc/clamav/ignore.list.lock"
  QuarantineRoot = "/var/lib/clamav/quarantine"
  RunUserDir     = "/run/user"
  HardenFlags    = ["nosuid", "nodev", "noexec"]

# flock(2) — std/posix exposes the syscall but not always the op constants.
const
  LOCK_EX_OP = cint(2)
  LOCK_UN_OP = cint(8)

proc flock(fd: cint, op: cint): cint {.importc, header: "<sys/file.h>".}

# ---------- helpers ----------

proc sysLog(msg: string) =
  ## Fire-and-forget syslog entry tagged `clamav`. Shells to logger(1) so we
  ## don't have to wire up openlog/syslog/closelog for a one-shot binary.
  try:
    let p = startProcess("/usr/bin/logger",
                         args = ["-t", "clamav", msg],
                         options = {})
    discard p.waitForExit()
    p.close()
  except OSError:
    discard

proc runCapture(prog: string, args: openArray[string]): tuple[code: int, output: string] =
  ## Run a process with no shell interposed, capture stdout (trimmed), return
  ## (exit code, output). stderr is left attached to the parent for debugging.
  let p = startProcess(prog, args = @args, options = {})
  result.output = p.outputStream.readAll().strip()
  result.code = p.waitForExit()
  p.close()

proc runWait(prog: string, args: openArray[string]): int =
  ## Run a process with no shell interposed, parent owns stdio, return exit code.
  let p = startProcess(prog, args = @args, options = {poParentStreams})
  result = p.waitForExit()
  p.close()

# ---------- ignore list ----------

proc ignoreMatches(file: string): bool =
  ## True if `file` matches any entry in the ignore list. A trailing `/` makes
  ## the entry a folder prefix; otherwise it is an exact file match.
  if not fileExists(IgnoreList): return false
  for raw in lines(IgnoreList):
    let line = raw.strip()
    if line.len == 0 or line.startsWith('#'): continue
    if line.endsWith('/'):
      if file.startsWith(line): return true
    else:
      if file == line: return true
  return false

proc appendIgnore(entry: string) =
  ## Append a line to the ignore list under an exclusive flock so concurrent
  ## VirusEvent invocations can't interleave writes.
  let lockFd = posix.open(IgnoreLockFile.cstring,
                          O_CREAT or O_RDWR, 0o600.Mode)
  if lockFd < 0:
    sysLog("ignore: cannot open lock file: " & $strerror(errno))
    return
  defer:
    discard flock(lockFd, LOCK_UN_OP)
    discard posix.close(lockFd)
  if flock(lockFd, LOCK_EX_OP) != 0:
    sysLog("ignore: flock failed: " & $strerror(errno))
    return
  let f = open(IgnoreList, fmAppend)
  defer: f.close()
  f.writeLine(entry)
  # Ensure readable by the clamav user (which runs cmdEvent and consults
  # this list) regardless of root's umask.
  setFilePermissions(IgnoreList,
    {fpUserRead, fpUserWrite, fpGroupRead, fpOthersRead})

# ---------- subcommands ----------

proc cmdInstall(userArg: string) =
  ## Copy the running binary to /etc/clamav/clamav-handler (mode 0755) and
  ## write the matching /etc/sudoers.d/clamav-handler rule.
  ##
  ## If not invoked as root, re-execs itself under sudo (which will prompt
  ## for the password) and returns sudo's exit code.
  if geteuid() != 0:
    echo "install: needs root — re-running via sudo (password prompt may follow)…"
    let args = @[getAppFilename()] & commandLineParams()
    let p = startProcess("/usr/bin/sudo", args = args,
                         options = {poParentStreams})
    let rc = p.waitForExit()
    p.close()
    quit(rc)

  let user =
    if userArg.len > 0: userArg
    else: getEnv("SUDO_USER")
  if user.len == 0:
    echo "install: provide a user — `clamav-handler install <user>` —"
    echo "        or run via sudo so $SUDO_USER is set."
    quit(1)

  # Capture the current on-disk location of the running binary (via
  # /proc/self/exe). This is the *source* for the copy — never the
  # destination constant — so we always install the bits the user just
  # built/invoked, regardless of where they were run from.
  let src = getAppFilename()
  if src == Self:
    echo &"-> already at {Self}; skipping copy."
  else:
    # install(1) copies src -> Self and applies mode 0755 to the copy in one
    # atomic operation; the source binary is left untouched.
    if runWait("/usr/bin/install", ["-m", "0755", src, Self]) != 0:
      echo "install: install(1) failed"
      quit(1)
    echo &"-> installed to {Self} (mode 0755)"

  let sudoers = &"""
# Auto-generated by `clamav-handler install`.
clamav ALL=(ALL) NOPASSWD: SETENV: /usr/bin/systemd-run --user --collect --quiet {Self} notify *
{user} ALL=(root) NOPASSWD: {Self} action *
"""

  echo &"-> writing {SudoersFile} (0440):"
  echo "--- begin ---"
  stdout.write(sudoers)
  echo "--- end ---"

  # Validate via visudo on a temp file before swapping into place, so a typo
  # can't render sudo unusable.
  let tmp = SudoersFile & ".new"
  writeFile(tmp, sudoers)
  setFilePermissions(tmp, {fpUserRead, fpGroupRead})  # 0440
  let visudoBin = findExe("visudo")
  if visudoBin.len > 0:
    if runWait(visudoBin, ["-cf", tmp]) != 0:
      removeFile(tmp)
      echo "install: visudo rejected the file; nothing written."
      quit(2)
  moveFile(tmp, SudoersFile)
  echo "-> done."
  echo ""
  echo "Update VirusEvent in clamd.conf and reload clamd:"
  echo &"   sed -i 's|^VirusEvent .*|VirusEvent {Self} event|' /etc/clamav/clamd.conf"
  echo "   systemctl reload clamav-daemon"

proc cmdEvent() =
  let file  = getEnv("CLAM_VIRUSEVENT_FILENAME")
  let virus = getEnv("CLAM_VIRUSEVENT_VIRUSNAME")
  if file.len == 0:
    sysLog("event: CLAM_VIRUSEVENT_FILENAME unset, refusing")
    return
  if ignoreMatches(file):
    sysLog(&"event: ignored {file} ({virus}) — matched ignore list")
    return

  if not dirExists(RunUserDir): return
  for kind, path in walkDir(RunUserDir, relative = false):
    if kind != pcDir: continue
    let uid = lastPathPart(path)
    if uid.len == 0 or not uid.allCharsInSet({'0'..'9'}): continue
    let bus = path / "bus"
    discard runWait("/usr/bin/sudo", [
      "-u", "#" & uid,
      "DBUS_SESSION_BUS_ADDRESS=unix:path=" & bus,
      "/usr/bin/systemd-run", "--user", "--collect", "--quiet",
      Self, "notify", file, virus,
    ])

proc cmdNotify(file, virus: string) =
  let prompt = &"Signature: {virus}\nFile: {file}\n\nChoose an action:"
  let (code, choice) = runCapture("/usr/bin/kdialog", [
    "--title", "Virus found!",
    "--radiolist", prompt,
    "quarantine", "Quarantine the file",   "off",
    "delete",     "Delete the file",       "off",
    "ignore",     "Ignore from now on",    "off",
    "dismiss",    "Take no action",        "on",
  ])
  if code != 0: return  # user cancelled / closed the dialog

  case choice
  of "quarantine":
    discard runWait("/usr/bin/sudo", ["-n", Self, "action", "quarantine", file])
  of "delete":
    discard runWait("/usr/bin/sudo", ["-n", Self, "action", "delete", file])
  of "ignore":
    let (pc, path) = runCapture("/usr/bin/kdialog", [
      "--title", "Ignore path",
      "--inputbox", "Edit the path to ignore:", file,
    ])
    if pc != 0 or path.len == 0: return
    let (sc, scope) = runCapture("/usr/bin/kdialog", [
      "--title", "Ignore scope",
      "--radiolist", "Match this entry as:",
      "file",   "File (exact match)",   "on",
      "folder", "Folder (recursive)",   "off",
    ])
    if sc != 0 or scope.len == 0: return
    discard runWait("/usr/bin/sudo",
                    ["-n", Self, "action", "ignore", scope, path])
  else:
    discard  # "dismiss" or anything unexpected → do nothing

proc quarantineMountFlags(): seq[string] =
  ## Returns the per-mount option list for QuarantineRoot from
  ## /proc/self/mountinfo, or @[] if it isn't a mount point.
  try:
    for line in lines("/proc/self/mountinfo"):
      let fields = line.split(' ')
      # mountinfo: id parent maj:min root mountpoint mount-options ...
      if fields.len < 6: continue
      if fields[4] == QuarantineRoot:
        return fields[5].split(',')
  except IOError:
    discard
  return @[]

proc ensureQuarantineHardened() =
  ## Idempotently bind-mount QuarantineRoot onto itself with nosuid,nodev,noexec.
  ## Must run as root. After first call per boot, all subsequent calls are
  ## a cheap mountinfo read.
  createDir(QuarantineRoot)
  setFilePermissions(QuarantineRoot,
    {fpUserRead, fpUserWrite, fpUserExec})

  let flags = quarantineMountFlags()
  let mounted = flags.len > 0
  var hardened = mounted
  for f in HardenFlags:
    if f notin flags:
      hardened = false
      break
  if hardened: return

  if not mounted:
    if runWait("/usr/bin/mount",
               ["--bind", QuarantineRoot, QuarantineRoot]) != 0:
      sysLog("quarantine: bind mount failed; proceeding unhardened")
      return
  if runWait("/usr/bin/mount",
             ["-o", "remount,bind," & HardenFlags.join(","),
              QuarantineRoot]) != 0:
    sysLog("quarantine: remount with hardening flags failed")

proc cmdActionQuarantine(file: string) =
  if not fileExists(file):
    sysLog(&"quarantine: {file} no longer present")
    return
  ensureQuarantineHardened()
  let rel  = if file.startsWith("/"): file[1 .. ^1] else: file
  let dest = QuarantineRoot / rel
  createDir(parentDir(dest))
  moveFile(file, dest)
  setFilePermissions(dest, {fpUserRead, fpUserWrite})
  sysLog(&"quarantined: {file} -> {dest}")

proc cmdActionDelete(file: string) =
  if not fileExists(file):
    sysLog(&"delete: {file} no longer present")
    return
  removeFile(file)
  sysLog(&"deleted: {file}")

proc cmdActionIgnore(scope, path: string) =
  let entry =
    if scope == "folder":
      if path.endsWith('/'): path else: path & "/"
    else:
      path
  appendIgnore(entry)
  sysLog(&"ignore: added {entry}")

# ---------- main ----------

proc main() =
  let args = docopt(Doc, version = "clamav-handler 0.1")
  if args["install"]:
    let userArg = if args["<user>"]: $args["<user>"] else: ""
    cmdInstall(userArg)
  elif args["event"]:
    cmdEvent()
  elif args["notify"]:
    cmdNotify($args["<file>"], $args["<virus>"])
  elif args["action"]:
    if args["quarantine"]:
      cmdActionQuarantine($args["<file>"])
    elif args["delete"]:
      cmdActionDelete($args["<file>"])
    elif args["ignore"]:
      let scope = if args["file"]: "file" else: "folder"
      cmdActionIgnore(scope, $args["<path>"])

when isMainModule:
  main()
