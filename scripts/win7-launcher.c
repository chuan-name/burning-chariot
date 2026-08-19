#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define BC_PATH_CAPACITY 1024

static WCHAR root[BC_PATH_CAPACITY];
static WCHAR runtime[BC_PATH_CAPACITY];
static WCHAR server[BC_PATH_CAPACITY];
static WCHAR game[BC_PATH_CAPACITY];
static WCHAR commandLine[BC_PATH_CAPACITY * 2];
static STARTUPINFOW startup;
static PROCESS_INFORMATION process;

static void writeError(const WCHAR *message)
{
    DWORD written;
    HANDLE stream = GetStdHandle(STD_ERROR_HANDLE);
    WriteConsoleW(stream, message, lstrlenW(message), &written, NULL);
    WriteConsoleW(stream, L"\r\n", 2, &written, NULL);
}

static BOOL appendPath(WCHAR *destination, const WCHAR *suffix)
{
    DWORD length = (DWORD)lstrlenW(destination);
    DWORD suffixLength = (DWORD)lstrlenW(suffix);
    if (length + suffixLength + 1 > BC_PATH_CAPACITY) return FALSE;
    lstrcatW(destination, suffix);
    return TRUE;
}

static BOOL isFile(const WCHAR *path)
{
    DWORD attributes = GetFileAttributesW(path);
    return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

static BOOL isDirectory(const WCHAR *path)
{
    DWORD attributes = GetFileAttributesW(path);
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

void wWinMainCRTStartup(void)
{
    DWORD length;
    DWORD exitCode = 1;

    startup.cb = sizeof(startup);

    length = GetModuleFileNameW(NULL, root, BC_PATH_CAPACITY);
    if (!length || length >= BC_PATH_CAPACITY) {
        writeError(L"Burning Chariot could not determine its directory.");
        ExitProcess(1);
    }
    while (length && root[length - 1] != L'\\' && root[length - 1] != L'/') length--;
    root[length] = L'\0';

    lstrcpynW(runtime, root, BC_PATH_CAPACITY);
    lstrcpynW(server, root, BC_PATH_CAPACITY);
    lstrcpynW(game, root, BC_PATH_CAPACITY);
    if (!appendPath(runtime, L"runtime\\node.exe") ||
        !appendPath(server, L"server\\win7-server.cjs") ||
        !appendPath(game, L"game")) {
        writeError(L"Burning Chariot installation path is too long.");
        ExitProcess(2);
    }

    if (!isFile(runtime) || !isFile(server) || !isDirectory(game)) {
        writeError(L"Burning Chariot files are incomplete.");
        writeError(L"Keep the EXE together with game, runtime and server folders.");
        ExitProcess(2);
    }

    commandLine[0] = L'\0';
    appendPath(commandLine, L"\"");
    appendPath(commandLine, runtime);
    appendPath(commandLine, L"\" \"");
    appendPath(commandLine, server);
    appendPath(commandLine, L"\"");

    SetEnvironmentVariableW(L"BC_GAME_ROOT", game);
    if (!CreateProcessW(runtime, commandLine, NULL, NULL, FALSE, 0, NULL, root, &startup, &process)) {
        writeError(L"Burning Chariot failed to start its bundled server runtime.");
        ExitProcess(1);
    }

    WaitForSingleObject(process.hProcess, INFINITE);
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    ExitProcess(exitCode);
}
