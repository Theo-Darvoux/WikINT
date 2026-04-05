rule EICAR_test_file
{
    meta:
        description = "EICAR anti-malware test file"
        reference = "https://www.eicar.org/download-anti-malware-testfile/"

    strings:
        $eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

    condition:
        $eicar
}
