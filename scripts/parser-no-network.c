#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define L4DSTATS_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define L4DSTATS_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#error "Unsupported parser sandbox architecture"
#endif

#define DENY_SYSCALL(name)                                                    \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##name, 0, 1),                    \
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA))

int main(int argc, char **argv) {
  if (argc < 2) {
    fputs("usage: parser-no-network <program> [arguments...]\n", stderr);
    return 64;
  }
  struct sock_filter filter[] = {
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, L4DSTATS_AUDIT_ARCH, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
      DENY_SYSCALL(socket),
      DENY_SYSCALL(socketpair),
      DENY_SYSCALL(io_uring_setup),
      DENY_SYSCALL(bpf),
      DENY_SYSCALL(ptrace),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  const struct sock_fprog program = {
      .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
      .filter = filter,
  };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("parser sandbox could not set no_new_privs");
    return 70;
  }
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) {
    perror("parser sandbox could not install seccomp filter");
    return 70;
  }
  execvp(argv[1], &argv[1]);
  perror("parser sandbox could not execute parser");
  return 71;
}
