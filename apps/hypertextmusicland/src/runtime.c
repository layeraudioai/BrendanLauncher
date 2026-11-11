/* Compiler-emitted freestanding memory primitives. No hosted libc is linked. */
#include <stddef.h>
void *memcpy(void *dst,const void *src,size_t n){unsigned char*d=(unsigned char*)dst;const unsigned char*s=(const unsigned char*)src;size_t i;for(i=0;i<n;i++)d[i]=s[i];return dst;}
void *memset(void *dst,int v,size_t n){unsigned char*d=(unsigned char*)dst;size_t i;for(i=0;i<n;i++)d[i]=(unsigned char)v;return dst;}
void *memmove(void *dst,const void *src,size_t n){unsigned char*d=(unsigned char*)dst;const unsigned char*s=(const unsigned char*)src;if(d<s){size_t i;for(i=0;i<n;i++)d[i]=s[i];}else if(d>s){while(n)d[n-1]=s[n-1],n--;}return dst;}
int memcmp(const void*a,const void*b,size_t n){const unsigned char*x=(const unsigned char*)a,*y=(const unsigned char*)b;size_t i;for(i=0;i<n;i++)if(x[i]!=y[i])return(int)x[i]-(int)y[i];return 0;}
