#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
typedef uint8_t u8; typedef uint32_t u32; typedef uint64_t u64; typedef int64_t s64; typedef int32_t Result;
#define FS_MAX_PATH 256
#define R_FAILED(x) ((x)!=0)
#define R_SUCCEEDED(x) ((x)==0)
#define FsOpenMode_Read 1
#define FsReadOption_None 0
#define FsDirOpenMode_ReadFiles 2
#define FsDirEntryType_File 1
#define NRO_MAGIC 0x304f524e
#define HidNpadButton_B (1ULL<<1)
#define HidNpadButton_A (1ULL<<0)
#define HidNpadButton_Down (1ULL<<15)
#define HidNpadButton_Up (1ULL<<13)
typedef struct { int unused; } FsFileSystem; typedef struct {int unused;} FsFile; typedef struct{int unused;} FsDir;
typedef struct{char name[FS_MAX_PATH];u8 pad[3];int8_t type;u8 pad2[3];s64 file_size;} FsDirectoryEntry;
typedef struct {int unused;} PadState;
extern void consoleInit(void*); extern void consoleClear(void); extern void consoleUpdate(void*); extern void consoleExit(void*);
extern Result fsInitialize(void); extern void fsExit(void); extern Result fsOpenSdCardFileSystem(FsFileSystem*); extern void fsFsClose(FsFileSystem*);
extern Result fsFsOpenFile(FsFileSystem*,const char*,u32,FsFile*); extern Result fsFileGetSize(FsFile*,s64*); extern Result fsFileRead(FsFile*,s64,void*,u64,u32,u64*); extern void fsFileClose(FsFile*);
extern Result fsFsOpenDirectory(FsFileSystem*,const char*,u32,FsDir*); extern Result fsDirRead(FsDir*,s64*,size_t,FsDirectoryEntry*); extern void fsDirClose(FsDir*);
extern int envHasNextLoad(void); extern Result envSetNextLoad(const char*,const char*);
extern void padInitializeDefault(PadState*); extern void padUpdate(PadState*); extern u64 padGetButtonsDown(PadState*);
extern int appletMainLoop(void); extern void svcSleepThread(s64); extern void exit(int);
