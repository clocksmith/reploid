/* Bounded userspace network degradation for the placement C envelope run (amd-host natives only).
 *
 * No privileges are available on amd-host for tc/netem, so this LD_PRELOAD shim is loaded only into the two
 * owned native stage processes (native-launch.sh `shape`). It touches only their non-loopback UDP datagrams,
 * i.e. the WebRTC (ICE/DTLS/SCTP) path to mac-host. Loopback traffic, TCP (the signaling WebSocket through the
 * ssh tunnel) and every other process are untouched. With no control file it passes every call through.
 *
 * Control file (NETSHAPE_CONTROL, re-read when its mtime changes, checked at most every 100 ms), one line:
 *   <delay ms> <jitter ms> <send loss %> <receive loss %> <outage until, epoch ms>
 * - delay/jitter: each outgoing datagram (amd-host -> mac-host) is released after delay + uniform(-jitter,
 *   +jitter) ms (never negative), first-in first-out per process, by one sender thread. No reordering.
 * - send loss: outgoing datagrams dropped with this probability (reported as sent, as a lossy link does).
 * - receive loss: incoming datagrams (mac-host -> amd-host) read and discarded with this probability;
 *   applied only on non-blocking sockets, so a read never blocks.
 * - outage: until that epoch ms, every outgoing and incoming datagram on those sockets is dropped.
 * Counters and every control change are appended to NETSHAPE_LOG every 5 s.
 * Build: gcc -O2 -shared -fPIC -o netshape.so netshape.c -ldl -lpthread */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

typedef ssize_t (*sendto_t)(int, const void *, size_t, int, const struct sockaddr *, socklen_t);
typedef ssize_t (*sendmsg_t)(int, const struct msghdr *, int);
typedef ssize_t (*recvfrom_t)(int, void *, size_t, int, struct sockaddr *, socklen_t *);
typedef ssize_t (*recvmsg_t)(int, struct msghdr *, int);
static sendto_t real_sendto; static sendmsg_t real_sendmsg; static recvfrom_t real_recvfrom; static recvmsg_t real_recvmsg;

struct shape { double delay, jitter, sendLoss, recvLoss; double outageUntil; };
static struct shape current; static pthread_mutex_t shapeLock = PTHREAD_MUTEX_INITIALIZER;
static const char *controlPath, *logPath; static struct timespec controlMtime; static double lastCheck;
static atomic_ulong sentPass, sentDelayed, sentDropped, sentOutage, recvPass, recvDropped, recvOutage;

struct packet { struct packet *next; int fd; double release; size_t len; struct sockaddr_storage to; socklen_t tolen; char data[]; };
static struct packet *head, *tail; static double lastRelease;
static pthread_mutex_t queueLock = PTHREAD_MUTEX_INITIALIZER; static pthread_cond_t queueCond = PTHREAD_COND_INITIALIZER;

static double nowMs(void) { struct timespec t; clock_gettime(CLOCK_REALTIME, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }
static double rand01(void) { static __thread unsigned int seed; if (!seed) seed = (unsigned int)(nowMs() * 1000) ^ (unsigned int)gettid(); return rand_r(&seed) / (RAND_MAX + 1.0); }

static void logLine(const char *text) {
  if (!logPath) return;
  FILE *f = fopen(logPath, "a"); if (!f) return;
  fprintf(f, "%.0f %s\n", nowMs(), text); fclose(f);
}

static void refresh(void) {
  double now = nowMs();
  if (now - lastCheck < 100) return;
  lastCheck = now;
  struct stat st; struct shape next = {0};
  if (!controlPath || stat(controlPath, &st) != 0) {
    if (controlMtime.tv_sec || controlMtime.tv_nsec) {
      pthread_mutex_lock(&shapeLock); memset(&current, 0, sizeof current); pthread_mutex_unlock(&shapeLock);
      memset(&controlMtime, 0, sizeof controlMtime); logLine("control removed: pass-through");
    }
    return;
  }
  if (st.st_mtim.tv_sec == controlMtime.tv_sec && st.st_mtim.tv_nsec == controlMtime.tv_nsec) return;
  FILE *f = fopen(controlPath, "r"); if (!f) return;
  int n = fscanf(f, "%lf %lf %lf %lf %lf", &next.delay, &next.jitter, &next.sendLoss, &next.recvLoss, &next.outageUntil);
  fclose(f);
  if (n != 5) return;
  pthread_mutex_lock(&shapeLock); current = next; pthread_mutex_unlock(&shapeLock);
  controlMtime = st.st_mtim;
  char line[256]; snprintf(line, sizeof line, "control delay=%.1f jitter=%.1f sendLoss=%.2f recvLoss=%.2f outageUntil=%.0f",
    next.delay, next.jitter, next.sendLoss, next.recvLoss, next.outageUntil);
  logLine(line);
}
static struct shape read_shape(void) { refresh(); pthread_mutex_lock(&shapeLock); struct shape s = current; pthread_mutex_unlock(&shapeLock); return s; }

static int loopback(const struct sockaddr *a) {
  if (!a) return 0;
  if (a->sa_family == AF_INET) return (ntohl(((const struct sockaddr_in *)a)->sin_addr.s_addr) >> 24) == 127;
  if (a->sa_family == AF_INET6) {
    const struct in6_addr *x = &((const struct sockaddr_in6 *)a)->sin6_addr;
    if (IN6_IS_ADDR_LOOPBACK(x)) return 1;
    if (IN6_IS_ADDR_V4MAPPED(x)) return x->s6_addr[12] == 127;
  }
  return 0;
}
static int udp(int fd) { int type = 0; socklen_t len = sizeof type; return getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &len) == 0 && type == SOCK_DGRAM; }
static int shaped(int fd, const struct sockaddr *peer) {
  if (!udp(fd)) return 0;
  if (peer) return !loopback(peer);
  struct sockaddr_storage local; socklen_t len = sizeof local;
  return getsockname(fd, (struct sockaddr *)&local, &len) == 0 && !loopback((struct sockaddr *)&local);
}

static void *sender(void *unused) {
  (void)unused;
  for (;;) {
    pthread_mutex_lock(&queueLock);
    while (!head) pthread_cond_wait(&queueCond, &queueLock);
    struct packet *p = head; double wait = p->release - nowMs();
    if (wait > 0) {
      struct timespec until; double at = (nowMs() + wait) / 1e3; until.tv_sec = (time_t)at; until.tv_nsec = (long)((at - until.tv_sec) * 1e9);
      pthread_cond_timedwait(&queueCond, &queueLock, &until); pthread_mutex_unlock(&queueLock); continue;
    }
    head = p->next; if (!head) tail = NULL;
    pthread_mutex_unlock(&queueLock);
    real_sendto(p->fd, p->data, p->len, MSG_DONTWAIT, p->tolen ? (struct sockaddr *)&p->to : NULL, p->tolen);
    free(p);
  }
  return NULL;
}
static void *reporter(void *unused) {
  (void)unused;
  for (;;) {
    sleep(5);
    char line[320]; snprintf(line, sizeof line, "counters sentPass=%lu sentDelayed=%lu sentDropped=%lu sentOutage=%lu recvPass=%lu recvDropped=%lu recvOutage=%lu",
      atomic_load(&sentPass), atomic_load(&sentDelayed), atomic_load(&sentDropped), atomic_load(&sentOutage),
      atomic_load(&recvPass), atomic_load(&recvDropped), atomic_load(&recvOutage));
    logLine(line);
  }
  return NULL;
}
__attribute__((constructor)) static void init(void) {
  real_sendto = (sendto_t)dlsym(RTLD_NEXT, "sendto"); real_sendmsg = (sendmsg_t)dlsym(RTLD_NEXT, "sendmsg");
  real_recvfrom = (recvfrom_t)dlsym(RTLD_NEXT, "recvfrom"); real_recvmsg = (recvmsg_t)dlsym(RTLD_NEXT, "recvmsg");
  controlPath = getenv("NETSHAPE_CONTROL"); logPath = getenv("NETSHAPE_LOG");
  pthread_t a, b; pthread_create(&a, NULL, sender, NULL); pthread_detach(a); pthread_create(&b, NULL, reporter, NULL); pthread_detach(b);
  logLine("loaded");
}

/* Returns 1 when the datagram was consumed (dropped or queued), 0 to send it now. */
static int shapeSend(int fd, const void *data, size_t len, const struct sockaddr *to, socklen_t tolen) {
  struct shape s = read_shape();
  double now = nowMs();
  if (s.outageUntil > now) { atomic_fetch_add(&sentOutage, 1); return 1; }
  if (s.sendLoss > 0 && rand01() * 100 < s.sendLoss) { atomic_fetch_add(&sentDropped, 1); return 1; }
  if (s.delay <= 0 && s.jitter <= 0) { atomic_fetch_add(&sentPass, 1); return 0; }
  double d = s.delay + (s.jitter > 0 ? (rand01() * 2 - 1) * s.jitter : 0); if (d < 0) d = 0;
  struct packet *p = malloc(sizeof *p + len); if (!p) return 0;
  p->next = NULL; p->fd = fd; p->len = len; memcpy(p->data, data, len); p->tolen = 0;
  if (to && tolen <= sizeof p->to) { memcpy(&p->to, to, tolen); p->tolen = tolen; }
  pthread_mutex_lock(&queueLock);
  p->release = now + d; if (p->release < lastRelease) p->release = lastRelease; lastRelease = p->release;
  if (tail) tail->next = p; else head = p; tail = p;
  pthread_cond_signal(&queueCond); pthread_mutex_unlock(&queueLock);
  atomic_fetch_add(&sentDelayed, 1);
  return 1;
}
ssize_t sendto(int fd, const void *buf, size_t len, int flags, const struct sockaddr *to, socklen_t tolen) {
  if (!real_sendto) real_sendto = (sendto_t)dlsym(RTLD_NEXT, "sendto");
  if (controlPath && shaped(fd, to) && shapeSend(fd, buf, len, to, tolen)) return (ssize_t)len;
  return real_sendto(fd, buf, len, flags, to, tolen);
}
ssize_t sendmsg(int fd, const struct msghdr *msg, int flags) {
  if (!real_sendmsg) real_sendmsg = (sendmsg_t)dlsym(RTLD_NEXT, "sendmsg");
  if (controlPath && msg && shaped(fd, (const struct sockaddr *)msg->msg_name)) {
    size_t len = 0; for (size_t i = 0; i < msg->msg_iovlen; i++) len += msg->msg_iov[i].iov_len;
    char *flat = malloc(len ? len : 1); if (!flat) return real_sendmsg(fd, msg, flags);
    size_t off = 0; for (size_t i = 0; i < msg->msg_iovlen; i++) { memcpy(flat + off, msg->msg_iov[i].iov_base, msg->msg_iov[i].iov_len); off += msg->msg_iov[i].iov_len; }
    int consumed = shapeSend(fd, flat, len, (const struct sockaddr *)msg->msg_name, msg->msg_namelen);
    free(flat);
    if (consumed) return (ssize_t)len;
  }
  return real_sendmsg(fd, msg, flags);
}
static int dropIncoming(int fd) {
  struct shape s = read_shape();
  if (s.outageUntil > nowMs()) { atomic_fetch_add(&recvOutage, 1); return 1; }
  if (s.recvLoss > 0 && rand01() * 100 < s.recvLoss) { atomic_fetch_add(&recvDropped, 1); return 1; }
  atomic_fetch_add(&recvPass, 1); return 0;
}
static int nonblocking(int fd, int flags) { return (flags & MSG_DONTWAIT) || (fcntl(fd, F_GETFL) & O_NONBLOCK); }
ssize_t recvfrom(int fd, void *buf, size_t len, int flags, struct sockaddr *from, socklen_t *fromlen) {
  if (!real_recvfrom) real_recvfrom = (recvfrom_t)dlsym(RTLD_NEXT, "recvfrom");
  for (;;) {
    socklen_t keep = fromlen ? *fromlen : 0;
    ssize_t n = real_recvfrom(fd, buf, len, flags, from, fromlen);
    if (n < 0 || !controlPath || (flags & MSG_PEEK) || !nonblocking(fd, flags) || !shaped(fd, from && fromlen && *fromlen ? from : NULL)) return n;
    if (!dropIncoming(fd)) return n;
    if (fromlen) *fromlen = keep;
  }
}
ssize_t recvmsg(int fd, struct msghdr *msg, int flags) {
  if (!real_recvmsg) real_recvmsg = (recvmsg_t)dlsym(RTLD_NEXT, "recvmsg");
  for (;;) {
    socklen_t keepName = msg ? msg->msg_namelen : 0; size_t keepControl = msg ? msg->msg_controllen : 0;
    ssize_t n = real_recvmsg(fd, msg, flags);
    if (n < 0 || !controlPath || (flags & MSG_PEEK) || !nonblocking(fd, flags)
        || !shaped(fd, msg && msg->msg_namelen ? (struct sockaddr *)msg->msg_name : NULL)) return n;
    if (!dropIncoming(fd)) return n;
    if (msg) { msg->msg_namelen = keepName; msg->msg_controllen = keepControl; }
  }
}
