# Chest Room

An OrcaSlicer tab for sizing cosplay breastplates, backplates and cuirasses.

## Install

In OrcaSlicer 2.5.0, open **File → Plugins**. Open the arrow beside **Install plugin**, select **Install local plugin**, click the install button and choose [chest_room_any.py](dist/chest_room_any.py). Activate **Chest Room** and open its tab. Keep the same filename for local updates.

You can also [try the standalone preview](dist/preview.html) in a desktop browser. The browser stores its own library and downloads fitted STLs.

## Fit a plate

1. Select **Make my torso** for the five illustrated measurements, or **Use torso STL** for an upright scan in millimetres, chest facing −Y. Measure over the layer you will wear under the armor. The five measurements produce an approximate dress form. Use a scan for an asymmetric torso or a more detailed bust profile.
2. Add a front plate, backplate, or both. An assembled cuirass can use the front slot. Select the piece you want to move, rotate or scale. Use **Reset this plate** under **Precise alignment** to restore its initial placement. Scroll to zoom and use Shift-drag or middle-drag to pan.
3. Turn on **Preview foam pads** for matching foam patches at the chest and upper back. The thickness is measured along the front–back axis. Sweep a front, side or top cut, drag the selected piece in the cut plane, or use **Measure gap** to measure between the body or a foam edge and the selected plate. A section shows clearance at that slice.
4. Use **Save fit…** to store both poses, the reference torso and foam thickness under a name and version. Reopen from **Library → Saved fits**. To revise a measured torso, choose it in the library and select **Modify torso**. The revision gets its own entry.
5. Select a plate and choose **Open plate in OrcaSlicer**. Each output contains only that plate at its fitted scale and orientation. The library preserves its placement relative to the other plate. If the system handoff is unavailable, Chest Room displays the saved STL path.

## Build and verify

Run `python3 build.py`, `python3 tests/host.py`, and `node tests/geometry.cjs`. With Playwright and desktop Chrome available, run `node tests/navigation.cjs`. Pass an optional local breastplate STL path to exercise the complete workflow with a real mesh. Set `CHROME_BIN` to choose a browser executable.

The packaged plugin includes the local 3D renderer and requires no external web resources. Plugin records and source meshes use Chest Room’s Orca plugin storage. See [the changelog](CHANGELOG.md) and [license](LICENSE).
