using System.Security.Cryptography;
using System.Text;

namespace PcControllerAgent;

// The pairing code the user copies to the phone: 12 characters like
// "K7M2-P9X4-QA3D" (60 random bits, Crockford base32 so there are no 0/O or
// 1/I/L mix-ups). Both the topic namespace ("agent id") and the AES key are
// derived from it, and the code itself never travels over the broker.
//
// The broker is public and anyone can subscribe to every retained message, so
// an attacker could grind through candidate codes offline. 60 bits is a lot,
// and PBKDF2 makes every single guess ~200,000x more expensive on top of that.
// Must stay identical to deriveFromCode() in src/crypto.ts.
public static class Pairing
{
    const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    public const int CodeLength = 12;
    const int Iterations = 200_000;
    static readonly byte[] Salt = Encoding.UTF8.GetBytes("pc-controller-agent-v1");

    public static string NewCode()
    {
        byte[] bytes = RandomNumberGenerator.GetBytes(CodeLength);
        var sb = new StringBuilder(CodeLength);
        foreach (byte b in bytes) sb.Append(Alphabet[b & 31]); // 256 is a multiple of 32, so no bias
        return sb.ToString();
    }

    // Accepts what people actually paste: lower case, dashes, spaces, and the
    // classic look-alikes (O→0, I/L→1). Null if it isn't a valid code.
    public static string? Normalize(string? input)
    {
        if (input == null) return null;
        var sb = new StringBuilder();
        foreach (char raw in input.ToUpperInvariant())
        {
            char c = raw switch { 'O' => '0', 'I' => '1', 'L' => '1', _ => raw };
            if (Alphabet.Contains(c)) sb.Append(c);
            else if (char.IsLetterOrDigit(c)) return null; // U or other non-alphabet character
        }
        return sb.Length == CodeLength ? sb.ToString() : null;
    }

    public static (string AgentId, byte[] Key) Derive(string code)
    {
        byte[] d = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(code), Salt, Iterations, HashAlgorithmName.SHA256, 36);
        return (Convert.ToHexString(d[32..36]).ToLowerInvariant(), d[..32]);
    }

    public static string Format(string code) => $"{code[..4]}-{code[4..8]}-{code[8..]}";
}
