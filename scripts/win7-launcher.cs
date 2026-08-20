using System;
using System.Diagnostics;
using System.IO;

internal static class BurningChariotLauncher
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string runtime = Path.Combine(root, @"runtime\node.exe");
            string server = Path.Combine(root, @"server\win7-server.cjs");
            string game = Path.Combine(root, "game");

            if (!File.Exists(runtime) || !File.Exists(server) || !Directory.Exists(game))
            {
                Console.Error.WriteLine("Burning Chariot files are incomplete.");
                Console.Error.WriteLine("Keep the EXE together with game, runtime and server folders.");
                Console.WriteLine("Press any key to close...");
                Console.ReadKey(true);
                return 2;
            }

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = runtime;
            start.Arguments = Quote(server);
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = false;
            start.EnvironmentVariables["BC_GAME_ROOT"] = game;

            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Burning Chariot failed to start:");
            Console.Error.WriteLine(error.Message);
            Console.WriteLine("Press any key to close...");
            Console.ReadKey(true);
            return 1;
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
