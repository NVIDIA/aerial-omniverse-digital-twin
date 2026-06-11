#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import numpy as np
import argparse
import pickle
import matplotlib.pyplot as plt

# This is an exemplary script plots the Channel Frequency Response.

if __name__ == "__main__":
    base = argparse.ArgumentParser()
    base.add_argument(
        "--filename",
        type=str,
        dest="filename",
        help="Specifies the data file",
        required=True,
    )

    base.add_argument(
        "--sample",
        type=int,
        dest="sample",
        help="Specifies the sample",
        required=True,
    )

    base.add_argument(
        "--RU",
        type=int,
        dest="ru",
        help="Specifies the RU ID",
        required=True,
    )

    base.add_argument(
        "--UE",
        type=int,
        dest="ue",
        help="Specifies the UE ID",
        required=True,
    )

    args = base.parse_args()

    ifile = open(args.filename, "rb")
    fft_size, scs, ue_fc, ru_fc, data = pickle.load(ifile)
    ifile.close()

    fig = plt.figure(figsize=(2 * 7.2, 2 * 4.8))

    rx_el = 0 #Default to tx0, rx0
    tx_el = 0
    fc_index =0 #Panel may have multiple frequencies. Default to 0.

    for idx, s_key in enumerate(data.keys()):

        if s_key == args.sample:

            cfr = data[s_key][args.ru][args.ue][:, rx_el, tx_el]

            frequencies = np.arange(ue_fc[fc_index] - fft_size * scs / 2 + scs/2,  ue_fc[fc_index] + fft_size * scs / 2 + scs/2, scs)

            plt.plot(frequencies, 20 * np.log10(np.abs(cfr)))

            plt.grid(True)
            plt.xlabel(r"$f$ [Hz]")
            plt.ylabel("Power [dBm]")

    plt.savefig(f"cfr-{str(args.sample).zfill(6)}.png", dpi=300)
    plt.show()
