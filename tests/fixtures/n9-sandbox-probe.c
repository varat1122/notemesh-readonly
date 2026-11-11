/* Benign sandbox capability probe, NOT a PDF exploit or workload generator. */
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/statvfs.h>
#include <sys/wait.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(x) do { if (!(x)) { fprintf(stderr,"probe failed line %d\n",__LINE__); return 1; } } while(0)
extern char **environ;
int main(int argc,char **argv){
  if(argc==2&&!strcmp(argv[1],"--sleep")){puts("ready");fflush(stdout);sleep(60);return 0;}
  CHECK(argc==5);CHECK(geteuid()!=0);
  CHECK(getenv("N9_SYNTHETIC_SECRET")==NULL);CHECK(getenv("ENCRYPTION_KEY")==NULL);
  int envc=0;for(char **e=environ;*e;e++)envc++;CHECK(envc==6);
  /* bubblewrap adds only its fixed sandbox working directory. */
  CHECK(getenv("PWD")&&strcmp(getenv("PWD"),"/tmp")==0);
  CHECK(access(argv[1],R_OK)<0);CHECK(access(argv[2],R_OK)<0);
  CHECK(open(argv[3],O_WRONLY|O_CREAT,0600)<0);
  CHECK(open("/bin/pdfinfo",O_WRONLY)<0);
  CHECK(access("/proc/1/environ",R_OK)<0);CHECK(access("/workspace",F_OK)<0);CHECK(access("/home",F_OK)<0);
  for(int fd=3;fd<32;fd++)CHECK(fcntl(fd,F_GETFD)==-1&&errno==EBADF);
  int fd=open("/tmp/disposable",O_WRONLY|O_CREAT,0600);CHECK(fd>=0);close(fd);
  struct statvfs v;CHECK(statvfs("/tmp",&v)==0);CHECK(v.f_blocks*v.f_frsize<=1048576);
  struct rlimit r;
  CHECK(getrlimit(RLIMIT_CPU,&r)==0&&r.rlim_max==4);
  CHECK(getrlimit(RLIMIT_AS,&r)==0&&r.rlim_max==268435456);
  CHECK(getrlimit(RLIMIT_NPROC,&r)==0&&r.rlim_max==1);
  CHECK(getrlimit(RLIMIT_NOFILE,&r)==0&&r.rlim_max==32);
  CHECK(getrlimit(RLIMIT_FSIZE,&r)==0&&r.rlim_max==1048576);
  CHECK(getrlimit(RLIMIT_CORE,&r)==0&&r.rlim_max==0);
  pid_t child=fork();if(child==0)_exit(0);if(child>0)waitpid(child,NULL,0);CHECK(child==-1);
  fd=socket(AF_INET,SOCK_STREAM,0);CHECK(fd>=0);
  struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons(atoi(argv[4]))};a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
  CHECK(connect(fd,(struct sockaddr*)&a,sizeof(a))<0);close(fd);
  puts("isolation PASS: environment filesystem network descriptors limits no-fork");return 0;
}
