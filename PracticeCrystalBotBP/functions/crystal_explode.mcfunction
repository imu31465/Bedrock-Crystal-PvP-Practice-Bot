# Crystal PvP - Crystal Explosion
# Execute crystal explode event on nearby end crystals (same as Crystalpvp addon)
execute @a[tag=crystal_explode_trigger] ~ ~ ~ execute @s ^ ^ ^2 event entity @e[r=2,c=1] minecraft:crystal_explode
tag @a remove crystal_explode_trigger
