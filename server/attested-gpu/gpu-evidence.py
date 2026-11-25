#!/usr/bin/env python3
"""GPU attestation evidence through NVML, for server/attested-gpu/cvm-evidence.js.

Usage: gpu-evidence.py <nonce as 64 hex characters>
Prints JSON: { "gpus": [ { index, architecture, ccMode, devToolsMode, report (base64), certificateChainPem } ] }

Needs the NVIDIA driver in confidential-computing mode and nvidia-ml-py (pip install nvidia-ml-py).
The nonce must be the 32-byte session digest; the report's SPDM request carries it and the requester checks it.
UNEXERCISED ON REAL HARDWARE until the first pilot.
"""
import base64
import ctypes
import json
import sys

import pynvml as nvml

ARCHITECTURES = {7: "hopper", 10: "blackwell"}  # NVML_DEVICE_ARCH_HOPPER = 7, NVML_DEVICE_ARCH_BLACKWELL = 10


def cc_state():
    state = nvml.nvmlSystemGetConfComputeState()
    # environment: 0 unavailable, 1 simulated, 2 hardware. ccFeature: 1 enabled. devToolsMode: 1 enabled (debug).
    if state.devToolsMode:
        return "devtools", True
    if state.environment == 2 and state.ccFeature == 1:
        return "on", False
    return "off", False


def attestation_report(handle, nonce):
    try:
        report = nvml.nvmlDeviceGetConfComputeGpuAttestationReport(handle, nonce)
    except TypeError:
        report = nvml.c_nvmlConfComputeGpuAttestationReport_t()
        ctypes.memmove(report.nonce, nonce, len(nonce))
        nvml.nvmlDeviceGetConfComputeGpuAttestationReport(handle, ctypes.byref(report))
    return bytes(report.attestationReport[: report.attestationReportSize])


def certificate_chain(handle):
    certificate = nvml.nvmlDeviceGetConfComputeGpuCertificate(handle)
    raw = bytes(certificate.attestationCertChain[: certificate.attestationCertChainSize])
    return raw.decode("ascii", errors="strict")


def main():
    if len(sys.argv) != 2 or len(sys.argv[1]) != 64:
        sys.exit("usage: gpu-evidence.py <64 hex characters>")
    nonce = bytes.fromhex(sys.argv[1])
    nvml.nvmlInit()
    try:
        mode, devtools = cc_state()
        ready = nvml.nvmlSystemGetConfComputeGpusReadyState()
        if mode == "on" and ready != 1:
            sys.exit("GPUs are in confidential-computing mode but not ready (nvidia-smi conf-compute -srs 1 after attestation)")
        gpus = []
        for index in range(nvml.nvmlDeviceGetCount()):
            handle = nvml.nvmlDeviceGetHandleByIndex(index)
            gpus.append({
                "index": index,
                "architecture": ARCHITECTURES.get(nvml.nvmlDeviceGetArchitecture(handle), "unknown"),
                "ccMode": mode,
                "devToolsMode": devtools,
                "report": base64.b64encode(attestation_report(handle, nonce)).decode("ascii"),
                "certificateChainPem": certificate_chain(handle),
            })
        json.dump({"gpus": gpus}, sys.stdout)
    finally:
        nvml.nvmlShutdown()


if __name__ == "__main__":
    main()
